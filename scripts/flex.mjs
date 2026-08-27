/**
 * カード仕様 → LINE Flex Message の JSON に変換する描画層。
 *
 * 仕様は gas-notify-hub の
 * docs/superpowers/specs/2026-08-26-line-flex-design.md（共通仕様）。
 * 実行環境が違うため実装は各リポジトリに複製している。ズレたら設計書が正。
 * このファイルは note-blog/scripts/flex.mjs と同一内容（コメント冒頭を除く）。
 */

export const FLEX_STATUS_COLOR = {
  info: '#4A6DA7',
  success: '#2E7D53',
  warn: '#B26A00',
  error: '#C0392B',
  neutral: '#555F6D',
};

export const FLEX_INK = {
  body: '#333333',
  muted: '#8C949E',
  separator: '#E5E7EB',
  up: '#2E7D53',
  down: '#C0392B',
  flat: '#8C949E',
  quoteBg: '#F7F8FA',
  quoteInk: '#4A5560',
};

// LINE の公称上限そのものではなく、安全側に取ったガード
export const FLEX_LIMITS = { altText: 400, buttonLabel: 20, json: 20000, actions: 3 };

function deltaColor(dir) {
  if (dir === 'up') return FLEX_INK.up;
  if (dir === 'down') return FLEX_INK.down;
  return FLEX_INK.flat;
}

export function clip(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * 箇条書きが長くなりすぎるのを防ぐ。
 * 黙って切り捨てず「ほか N 件」を残す（切ったことを画面に出す）。
 */
export function capItems(items, max) {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `…ほか ${items.length - max} 件`];
}

function renderRow(row) {
  const hasDelta = row.delta !== null && row.delta !== undefined && row.delta !== '';
  const contents = [
    { type: 'text', text: String(row.label), size: 'xs', color: FLEX_INK.muted, flex: 3 },
    {
      type: 'text',
      text: String(row.value),
      size: 'sm',
      color: FLEX_INK.body,
      align: 'end',
      flex: hasDelta ? 5 : 9,
    },
  ];
  if (hasDelta) {
    contents.push({
      type: 'text',
      text: String(row.delta),
      size: 'sm',
      weight: 'bold',
      color: deltaColor(row.dir),
      align: 'end',
      flex: 4,
    });
  }
  return { type: 'box', layout: 'baseline', spacing: 'sm', contents };
}

function renderBlock(block) {
  switch (block.kind) {
    case 'heading':
      return {
        type: 'text',
        text: String(block.text),
        size: 'xxs',
        weight: 'bold',
        color: FLEX_INK.muted,
        margin: 'lg',
        wrap: true,
      };
    case 'title':
      return {
        type: 'text',
        text: String(block.text),
        size: 'sm',
        weight: 'bold',
        color: FLEX_INK.body,
        margin: 'md',
        wrap: true,
      };
    case 'text':
      return {
        type: 'text',
        text: String(block.text),
        size: 'xs',
        color: block.muted ? FLEX_INK.muted : FLEX_INK.body,
        margin: 'sm',
        wrap: true,
      };
    case 'quote':
      return {
        type: 'box',
        layout: 'vertical',
        backgroundColor: FLEX_INK.quoteBg,
        cornerRadius: '6px',
        paddingAll: '10px',
        margin: 'md',
        contents: [
          {
            type: 'text',
            text: String(block.text),
            size: 'xs',
            color: FLEX_INK.quoteInk,
            wrap: true,
          },
        ],
      };
    case 'rows':
      return {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        margin: 'sm',
        contents: block.rows.map(renderRow),
      };
    case 'bullets':
      return {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        margin: 'sm',
        contents: block.items.map((item) => ({
          type: 'box',
          layout: 'horizontal',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '・', size: 'xs', color: FLEX_INK.muted, flex: 0 },
            {
              type: 'text',
              text: String(item),
              size: 'xs',
              color: FLEX_INK.body,
              wrap: true,
              flex: 1,
            },
          ],
        })),
      };
    case 'separator':
      return { type: 'separator', margin: 'md', color: FLEX_INK.separator };
    default:
      throw new Error(`未知のブロック種別: ${block.kind}`);
  }
}

/**
 * spec.action（単数）と spec.actions（複数）を1本のリストにまとめる。
 * 上限を超えた分は捨てる。ボタンが並びすぎるとカードが読みにくくなるため。
 */
export function collectActions(spec) {
  const all = [
    ...(spec.action?.uri ? [spec.action] : []),
    ...(Array.isArray(spec.actions) ? spec.actions.filter((a) => a?.uri) : []),
  ];
  return all.slice(0, FLEX_LIMITS.actions);
}

/** カード仕様 → { altText, contents } */
export function buildFlexCard(spec) {
  const color = FLEX_STATUS_COLOR[spec.status] ?? FLEX_STATUS_COLOR.neutral;

  const header = [
    {
      type: 'text',
      text: String(spec.title),
      color: '#FFFFFF',
      weight: 'bold',
      size: 'sm',
      wrap: true,
      flex: 1,
    },
  ];
  if (spec.subtitle) {
    header.push({
      type: 'text',
      text: String(spec.subtitle),
      color: '#FFFFFF',
      size: 'xs',
      align: 'end',
      gravity: 'center',
      flex: 0,
    });
  }

  const blocks = (spec.blocks ?? []).filter(Boolean).map(renderBlock);
  if (blocks.length > 0) blocks[0] = { ...blocks[0], margin: 'none' };

  const bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: color,
      paddingAll: '12px',
      spacing: 'sm',
      contents: header,
    },
  };
  // 中身が無いときは body 自体を出さない。「内容なし」のような
  // プレースホルダは読む側に何も伝えないため置かない（設計書 3節）
  if (blocks.length > 0) {
    bubble.body = { type: 'box', layout: 'vertical', paddingAll: '14px', contents: blocks };
  }

  // action（単数）と actions（複数）の両方を受ける。
  // Flex の text は URL をリンクにしないので、本文にURLを書いてもタップできない。
  // 複数の行き先があるならボタンにする（設計書 3節の拡張）。
  const links = collectActions(spec);
  if (links.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      paddingAll: '6px',
      contents: links.map((a) => ({
        type: 'button',
        style: 'link',
        height: 'sm',
        color,
        action: {
          type: 'uri',
          label: clip(a.label || '開く', FLEX_LIMITS.buttonLabel),
          uri: a.uri,
        },
      })),
    };
  }

  return { altText: clip(spec.altText || spec.title, FLEX_LIMITS.altText), contents: bubble };
}

// bubble は contents ではなく header / hero / body / footer に子を持つ
const CHILD_KEYS = ['contents', 'header', 'hero', 'body', 'footer'];

function walk(node, found) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found);
    return found;
  }
  if (node.type === 'text') found.push(node);
  if (node.action) found.push({ __action: node.action });
  for (const key of CHILD_KEYS) if (node[key]) walk(node[key], found);
  return found;
}

/** 送信前の機械的検査。問題があれば説明の配列を返す（空配列なら問題なし） */
export function validateFlexPayload(payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object') return ['payload がオブジェクトではない'];

  const alt = payload.altText;
  if (typeof alt !== 'string' || alt.length === 0) {
    problems.push('altText が空');
  } else if (alt.length > FLEX_LIMITS.altText) {
    problems.push(`altText が ${FLEX_LIMITS.altText} 文字を超えている (${alt.length})`);
  }

  if (payload.contents?.type !== 'bubble') {
    problems.push('contents が bubble ではない');
    return problems;
  }

  for (const node of walk(payload.contents, [])) {
    if (node.__action) {
      const label = node.__action.label;
      if (typeof label === 'string' && label.length > FLEX_LIMITS.buttonLabel) {
        problems.push(`ボタンの label が ${FLEX_LIMITS.buttonLabel} 文字を超えている: ${label}`);
      }
      continue;
    }
    if (typeof node.text !== 'string' || node.text.length === 0) {
      problems.push('空の text ノードがある');
    }
  }

  const size = JSON.stringify(payload.contents).length;
  if (size > FLEX_LIMITS.json) {
    problems.push(`JSON が大きすぎる (${size} > ${FLEX_LIMITS.json})`);
  }

  return problems;
}

/**
 * カード仕様をプレーンテキストに落とす。
 * CI のログ出力と、Flex を送れなかったときのフォールバック本文に使う。
 * カードとログで内容がズレないよう、情報源を1つにするための関数。
 */
export function cardToPlainText(spec) {
  const out = [spec.subtitle ? `${spec.title} ${spec.subtitle}` : String(spec.title)];
  for (const block of spec.blocks ?? []) {
    if (!block) continue;
    switch (block.kind) {
      case 'heading':
        out.push('', `【${block.text}】`);
        break;
      case 'title':
        out.push(String(block.text));
        break;
      case 'text':
        out.push(String(block.text));
        break;
      case 'quote':
        out.push(String(block.text));
        break;
      case 'rows':
        for (const r of block.rows) {
          out.push(`${r.label}: ${r.value}${r.delta ? ` (${r.delta})` : ''}`);
        }
        break;
      case 'bullets':
        for (const item of block.items) out.push(`・${item}`);
        break;
      case 'separator':
        break;
      default:
        throw new Error(`未知のブロック種別: ${block.kind}`);
    }
  }
  const links = collectActions(spec);
  if (links.length > 0) {
    out.push('');
    for (const a of links) out.push(a.label ? `${a.label}: ${a.uri}` : a.uri);
  }
  return out.join('\n');
}
