#!/usr/bin/env node
/**
 * ルーティンから LINE へ Flex Message を送るための CLI。依存なしで動く。
 *
 * ルーティンのプロンプトに Flex の JSON を直書きさせない。
 * ルーティンが書くのは「カード仕様」（設計書 3.2節）だけで、
 * Flex への変換・検証・フォールバックはこのスクリプトが持つ。
 *
 * 使い方:
 *   node scripts/notify-line.mjs --spec /tmp/card.json
 *   node scripts/notify-line.mjs --spec /tmp/card.json --dry   # 送信せず内容だけ出す
 *
 * カード仕様の例:
 *   {
 *     "status": "info",
 *     "title": "🎴 ポケセン抽選",
 *     "subtitle": "8/27(木)",
 *     "altText": "ポケセン抽選 8/27 追加抽選は明日12時から",
 *     "blocks": [
 *       { "kind": "heading", "text": "いまの状況" },
 *       { "kind": "text",    "text": "第1弾は終了。追加抽選が明日開始。" },
 *       { "kind": "rows",    "rows": [{ "label": "応募開始まで", "value": "約28時間" }] },
 *       { "kind": "separator" },
 *       { "kind": "bullets", "items": ["メールアドレスの一致を確認"] }
 *     ],
 *     "action": { "label": "POL を開く", "uri": "https://..." }
 *   }
 *
 * status は info | success | warn | error | neutral。
 * **実態に合わせて渡すこと。** 締切が迫っている/受付中なら warn、
 * 何も起きていない日は neutral、というように色で深刻度を伝える。
 * 迷ったら neutral。推測で error を使わない（色が信用できなくなる）。
 *
 * 必要な環境変数:
 *   NEXEED_LINE_CHANNEL_ACCESS_TOKEN
 *   NEXEED_LINE_USER_ID
 */
import { readFileSync } from 'node:fs';
import { buildFlexCard, capItems, cardToPlainText, clip, validateFlexPayload } from './flex.mjs';

const VALID_STATUS = ['success', 'info', 'warn', 'error', 'neutral'];
const VALID_KINDS = ['heading', 'title', 'text', 'quote', 'rows', 'bullets', 'separator'];
const MAX_BULLETS = 12;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry') {
      out.dry = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} に値がありません`);
    }
    i++;
    out[key] = value;
  }
  return out;
}

function isNonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * カード仕様を検査して整える。
 *
 * 空文字の text ノードは LINE がエラーにするため、**落とすのではなく落として通す**。
 * ルーティンが「該当なし」で空文字を入れてしまっても通知そのものは失わせない。
 * 落としたことは戻り値の warnings に残す（無言で減らさない）。
 */
export function normalizeSpec(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('カード仕様がオブジェクトではありません');
  }
  if (!isNonEmpty(raw.title)) throw new Error('title は必須です（空文字不可）');

  const status = raw.status ?? 'neutral';
  if (!VALID_STATUS.includes(status)) {
    throw new Error(`status は ${VALID_STATUS.join(' | ')} のいずれかです: ${status}`);
  }

  const blocks = [];
  for (const block of Array.isArray(raw.blocks) ? raw.blocks : []) {
    if (!block || typeof block !== 'object') {
      warnings.push('ブロックがオブジェクトではないので落としました');
      continue;
    }
    if (!VALID_KINDS.includes(block.kind)) {
      throw new Error(`未知のブロック種別: ${block.kind}`);
    }
    if (block.kind === 'separator') {
      blocks.push({ kind: 'separator' });
      continue;
    }
    if (block.kind === 'rows') {
      const rows = (Array.isArray(block.rows) ? block.rows : []).filter(
        (r) => r && isNonEmpty(r.label) && isNonEmpty(String(r.value ?? '')),
      );
      if (rows.length === 0) {
        warnings.push('rows が空なので落としました');
        continue;
      }
      blocks.push({ kind: 'rows', rows });
      continue;
    }
    if (block.kind === 'bullets') {
      const items = (Array.isArray(block.items) ? block.items : []).filter(isNonEmpty);
      if (items.length === 0) {
        warnings.push('bullets が空なので落としました');
        continue;
      }
      if (items.length > MAX_BULLETS) {
        warnings.push(`bullets が ${items.length} 件あるので ${MAX_BULLETS} 件に丸めました`);
      }
      blocks.push({ kind: 'bullets', items: capItems(items, MAX_BULLETS) });
      continue;
    }
    // heading / title / text / quote
    if (!isNonEmpty(block.text)) {
      warnings.push(`${block.kind} の text が空なので落としました`);
      continue;
    }
    blocks.push({ kind: block.kind, text: block.text.trim(), muted: block.muted === true });
  }

  // 末尾の separator は線だけが浮くので落とす
  while (blocks.length > 0 && blocks[blocks.length - 1].kind === 'separator') blocks.pop();

  const action =
    raw.action && isNonEmpty(raw.action.uri)
      ? { label: isNonEmpty(raw.action.label) ? raw.action.label : '開く', uri: raw.action.uri }
      : null;

  const spec = {
    status,
    title: raw.title.trim(),
    subtitle: isNonEmpty(raw.subtitle) ? raw.subtitle.trim() : undefined,
    altText: clip(isNonEmpty(raw.altText) ? raw.altText.trim() : raw.title.trim(), 400),
    blocks,
    action,
  };
  return { spec, warnings };
}

async function push(message) {
  const token = process.env.NEXEED_LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.NEXEED_LINE_USER_ID;
  if (!token || !to) {
    throw new Error('NEXEED_LINE_CHANNEL_ACCESS_TOKEN / NEXEED_LINE_USER_ID が未設定です');
  }
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, messages: [message] }),
  });
  if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spec) throw new Error('--spec <カード仕様のJSONファイル> は必須です');

  let raw;
  try {
    raw = JSON.parse(readFileSync(args.spec, 'utf8'));
  } catch (e) {
    throw new Error(`カード仕様を読めません (${args.spec}): ${e.message}`);
  }

  const { spec, warnings } = normalizeSpec(raw);
  for (const w of warnings) console.error(`⚠ ${w}`);

  const plain = cardToPlainText(spec);
  let card;
  let problems;
  try {
    card = buildFlexCard(spec);
    problems = validateFlexPayload(card);
  } catch (e) {
    // 組み立てで落ちても通知そのものを消さない
    problems = [`組み立てで例外: ${e.message}`];
  }

  if (args.dry) {
    console.log('--- 送信内容（--dry のため送信しません） ---');
    console.log(plain);
    console.log('--- altText ---');
    console.log(card ? card.altText : '(組み立てに失敗)');
    console.log('--- 検証 ---');
    console.log(problems.length === 0 ? 'OK' : problems.join('\n'));
    return;
  }

  // 見た目より「通知を失わないこと」を優先する（設計書 5節）
  if (!card || problems.length > 0) {
    console.error(`⚠ Flex 検証に失敗: ${problems.join(' / ')} → テキストで送信します`);
    await push({ type: 'text', text: plain.slice(0, 4900) });
    console.log('LINE 通知を送信しました（テキストにフォールバック）');
    return;
  }
  try {
    await push({ type: 'flex', altText: card.altText, contents: card.contents });
  } catch (e) {
    console.error(`⚠ Flex 送信に失敗: ${e.message} → テキストで再送します`);
    await push({ type: 'text', text: plain.slice(0, 4900) });
    console.log('LINE 通知を送信しました（テキストにフォールバック）');
    return;
  }
  console.log('LINE 通知を送信しました（Flex）');
}

// テストから import できるよう、直接実行されたときだけ走らせる
if (process.argv[1]?.endsWith('notify-line.mjs')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
