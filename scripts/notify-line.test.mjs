import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFlexCard, cardToPlainText, validateFlexPayload } from './flex.mjs';
import { normalizeSpec, parseArgs } from './notify-line.mjs';

/** 実際にルーティンが書くのと同じ形のカード仕様 */
function samplePokemonSpec() {
  return {
    status: 'warn',
    title: '🎴 沖縄ポケカ抽選',
    subtitle: '8/27(木)',
    altText: 'ゲオ抽選 8/31 11:00開始。沖縄店舗が対象か要確認',
    blocks: [
      { kind: 'heading', text: '応募できるもの' },
      { kind: 'text', text: '現在応募できるものはありません' },
      { kind: 'separator' },
      { kind: 'heading', text: '予定・監視中' },
      { kind: 'title', text: 'ゲオ 30th CELEBRATION 他' },
      {
        kind: 'rows',
        rows: [
          { label: '応募', value: '8/31 11:00〜9/3 17:59' },
          { label: '開始まで', value: '約92時間' },
        ],
      },
      { kind: 'text', text: '店頭受取のみ・沖縄対象か要確認', muted: true },
      { kind: 'heading', text: 'アプリで確認（自動確認できません）' },
      { kind: 'bullets', items: ['サンエーアプリ', 'iAEONアプリ'] },
    ],
    action: { label: 'ゲオの告知を開く', uri: 'https://geo-online.co.jp/news/779' },
  };
}

test('parseArgs は --spec と --dry を読む', () => {
  assert.deepEqual(parseArgs(['--spec', '/tmp/a.json', '--dry']), {
    spec: '/tmp/a.json',
    dry: true,
  });
});

test('parseArgs は値の無いフラグを弾く', () => {
  assert.throws(() => parseArgs(['--spec']), /--spec に値がありません/);
});

test('title が無ければ失敗する', () => {
  assert.throws(() => normalizeSpec({ blocks: [] }), /title は必須/);
  assert.throws(() => normalizeSpec({ title: '   ' }), /title は必須/);
});

test('未知の status は弾く', () => {
  assert.throws(() => normalizeSpec({ title: 'x', status: 'danger' }), /status は/);
});

test('status を省略すると neutral になる（推測で色を付けない）', () => {
  const { spec } = normalizeSpec({ title: 'x' });
  assert.equal(spec.status, 'neutral');
});

test('未知のブロック種別は弾く', () => {
  assert.throws(
    () => normalizeSpec({ title: 'x', blocks: [{ kind: 'table' }] }),
    /未知のブロック種別: table/,
  );
});

test('空の text ブロックは落とし、落としたことを警告に残す', () => {
  const { spec, warnings } = normalizeSpec({
    title: 'x',
    blocks: [{ kind: 'text', text: '  ' }, { kind: 'text', text: '残る' }],
  });
  assert.deepEqual(spec.blocks, [{ kind: 'text', text: '残る', muted: false }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /text の text が空/);
});

test('空の rows / bullets は落とす', () => {
  const { spec, warnings } = normalizeSpec({
    title: 'x',
    blocks: [
      { kind: 'rows', rows: [{ label: '', value: '' }] },
      { kind: 'bullets', items: ['', '  '] },
    ],
  });
  assert.deepEqual(spec.blocks, []);
  assert.equal(warnings.length, 2);
});

test('bullets は 12 件で丸め、「ほか N 件」を残す', () => {
  const items = Array.from({ length: 15 }, (_, i) => `項目${i + 1}`);
  const { spec, warnings } = normalizeSpec({ title: 'x', blocks: [{ kind: 'bullets', items }] });
  assert.equal(spec.blocks[0].items.length, 13);
  assert.equal(spec.blocks[0].items.at(-1), '…ほか 3 件');
  assert.match(warnings[0], /12 件に丸めました/);
});

test('末尾の separator は落とす（線だけが浮くため）', () => {
  const { spec } = normalizeSpec({
    title: 'x',
    blocks: [{ kind: 'text', text: 'a' }, { kind: 'separator' }, { kind: 'separator' }],
  });
  assert.deepEqual(spec.blocks.map((b) => b.kind), ['text']);
});

test('uri の無い action は落とし、label の無い action は「開く」になる', () => {
  assert.equal(normalizeSpec({ title: 'x', action: { label: 'a' } }).spec.action, null);
  assert.equal(
    normalizeSpec({ title: 'x', action: { uri: 'https://example.com' } }).spec.action.label,
    '開く',
  );
});

test('altText を省略すると title を使い、400 文字で切る', () => {
  assert.equal(normalizeSpec({ title: 'タイトル' }).spec.altText, 'タイトル');
  const long = 'あ'.repeat(500);
  const { spec } = normalizeSpec({ title: 'x', altText: long });
  assert.equal(spec.altText.length, 400);
  assert.ok(spec.altText.endsWith('…'));
});

test('実際のカード仕様が検証を通る', () => {
  const { spec, warnings } = normalizeSpec(samplePokemonSpec());
  assert.deepEqual(warnings, []);
  const card = buildFlexCard(spec);
  assert.deepEqual(validateFlexPayload(card), []);
});

test('ヘッダにステータス色と subtitle が入る', () => {
  const { spec } = normalizeSpec(samplePokemonSpec());
  const card = buildFlexCard(spec);
  assert.equal(card.contents.header.backgroundColor, '#B26A00'); // warn
  assert.equal(card.contents.header.contents.at(-1).text, '8/27(木)');
});

test('ブロックが1つも無いときは body を出さない', () => {
  const { spec } = normalizeSpec({ title: 'x', blocks: [{ kind: 'text', text: '' }] });
  const card = buildFlexCard(spec);
  assert.equal(card.contents.body, undefined);
  assert.deepEqual(validateFlexPayload(card), []);
});

test('フォールバック本文にカードの中身が残る', () => {
  const { spec } = normalizeSpec(samplePokemonSpec());
  const plain = cardToPlainText(spec);
  assert.match(plain, /ゲオ 30th CELEBRATION 他/);
  assert.match(plain, /応募: 8\/31 11:00〜9\/3 17:59/);
  assert.match(plain, /・サンエーアプリ/);
  assert.match(plain, /geo-online\.co\.jp\/news\/779/);
});

test('長すぎる本文は JSON サイズの検証で弾かれる（フォールバックへ回す）', () => {
  const { spec } = normalizeSpec({
    title: 'x',
    blocks: [{ kind: 'text', text: 'あ'.repeat(30000) }],
  });
  const problems = validateFlexPayload(buildFlexCard(spec));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /JSON が大きすぎる/);
});
