import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FLEX_LIMITS, buildFlexCard, cardToPlainText, validateFlexPayload } from './flex.mjs';
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
    actions: [
      { label: 'ゲオの告知', uri: 'https://geo-online.co.jp/news/779' },
      { label: 'ゲオ 再販の告知', uri: 'https://geo-online.co.jp/news/781' },
    ],
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

test('uri の無いボタンは落とし、label の無いボタンは「開く」になる', () => {
  assert.deepEqual(normalizeSpec({ title: 'x', action: { label: 'a' } }).spec.actions, []);
  assert.equal(
    normalizeSpec({ title: 'x', action: { uri: 'https://example.com' } }).spec.actions[0].label,
    '開く',
  );
});

test('action（単数）と actions（複数）は1本にまとまる', () => {
  const { spec } = normalizeSpec({
    title: 'x',
    action: { label: '1つめ', uri: 'https://a.example' },
    actions: [{ label: '2つめ', uri: 'https://b.example' }],
  });
  assert.deepEqual(spec.actions.map((a) => a.label), ['1つめ', '2つめ']);
});

test('ボタンは3個で打ち切り、打ち切ったことを警告に残す', () => {
  const actions = Array.from({ length: 5 }, (_, i) => ({
    label: `L${i}`,
    uri: `https://e${i}.example`,
  }));
  const { spec, warnings } = normalizeSpec({ title: 'x', actions });
  assert.equal(spec.actions.length, FLEX_LIMITS.actions);
  assert.match(warnings[0], /先頭 3 個だけ残しました/);
});

test('ボタンが複数あると footer にボタンが複数並ぶ', () => {
  const { spec } = normalizeSpec(samplePokemonSpec());
  const card = buildFlexCard(spec);
  const buttons = card.contents.footer.contents;
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].action.uri, 'https://geo-online.co.jp/news/779');
  assert.equal(buttons[1].action.uri, 'https://geo-online.co.jp/news/781');
  assert.deepEqual(validateFlexPayload(card), []);
});

test('長いボタン label は20文字に切られる（検証は通る）', () => {
  const { spec } = normalizeSpec({
    title: 'x',
    blocks: [{ kind: 'text', text: 'a' }],
    actions: [{ label: 'あ'.repeat(30), uri: 'https://example.com' }],
  });
  // 描画層が20文字に切るので、検証は通る（label は切られている）
  const card = buildFlexCard(spec);
  assert.equal(card.contents.footer.contents[0].action.label.length, 20);
  assert.deepEqual(validateFlexPayload(card), []);
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
  // ボタンが複数あっても、フォールバック本文にはすべてのURLが残る
  assert.match(plain, /geo-online\.co\.jp\/news\/781/);
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
