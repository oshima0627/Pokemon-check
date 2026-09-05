import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  DEFAULT_MAX_CHARS,
  absolutize,
  decodeEntities,
  fetchPage,
  filterLines,
  htmlToText,
  parseArgs,
} from './fetch-page.mjs';

test('parseArgs: URL だけで既定値が入る', () => {
  const a = parseArgs(['https://example.com/news/']);
  assert.equal(a.url, 'https://example.com/news/');
  assert.equal(a.max, DEFAULT_MAX_CHARS);
  assert.equal(a.grep, undefined);
  assert.equal(a.raw, false);
});

test('parseArgs: オプションを読む', () => {
  const a = parseArgs(['https://example.com/', '--grep', 'ポケモン|抽選', '--max', '500', '--timeout', '5', '--raw']);
  assert.equal(a.grep, 'ポケモン|抽選');
  assert.equal(a.max, 500);
  assert.equal(a.timeout, 5);
  assert.equal(a.raw, true);
});

test('parseArgs: URL 無し・http以外・未知のオプションは弾く', () => {
  assert.throws(() => parseArgs([]), /URL が指定されていません/);
  assert.throws(() => parseArgs(['ftp://example.com/']), /http\(s\) の URL/);
  assert.throws(() => parseArgs(['https://example.com/', '--nope', '1']), /未知のオプション/);
  assert.throws(() => parseArgs(['https://example.com/', '--grep']), /値がありません/);
  assert.throws(() => parseArgs(['https://a.example/', 'https://b.example/']), /URL は1つだけ/);
});

test('decodeEntities: 名前・10進・16進', () => {
  assert.equal(decodeEntities('A&amp;B &lt;tag&gt; &quot;q&quot;'), 'A&B <tag> "q"');
  assert.equal(decodeEntities('&#12509;&#12465;'), 'ポケ');
  assert.equal(decodeEntities('&#x30DD;&#x30B1;'), 'ポケ');
  assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;');
});

test('absolutize: 相対パスを絶対にする', () => {
  assert.equal(absolutize('/news/779', 'https://geo-online.co.jp/news/'), 'https://geo-online.co.jp/news/779');
  assert.equal(absolutize('779', 'https://geo-online.co.jp/news/'), 'https://geo-online.co.jp/news/779');
  assert.equal(absolutize('https://other.example/x', 'https://geo-online.co.jp/news/'), 'https://other.example/x');
});

test('htmlToText: script / style / comment を落とす', () => {
  const html = '<style>.a{color:red}</style><script>var x=1;</script><!-- メモ --><p>本文</p>';
  assert.equal(htmlToText(html), '本文');
});

test('htmlToText: リンクは URL を残す（一覧から記事URLを拾えること）', () => {
  const html = `
    <ul>
      <li><span>2026/08/21</span><a href="/news/779">ポケモンカード 抽選販売受付のお知らせ</a></li>
      <li><a href='/news/781'>再販商品 抽選販売受付のお知らせ</a></li>
    </ul>`;
  const text = htmlToText(html, 'https://geo-online.co.jp/news/');
  assert.match(text, /ポケモンカード 抽選販売受付のお知らせ \(https:\/\/geo-online\.co\.jp\/news\/779\)/);
  assert.match(text, /再販商品 抽選販売受付のお知らせ \(https:\/\/geo-online\.co\.jp\/news\/781\)/);
});

test('htmlToText: アンカー・javascript・mailto は URL を出さない', () => {
  const html = '<a href="#top">上へ</a><a href="javascript:void(0)">開く</a><a href="mailto:a@b.c">連絡</a>';
  const text = htmlToText(html, 'https://example.com/');
  assert.equal(text, '上へ 開く 連絡');
});

test('htmlToText: ブロック要素で改行し、空行と余分な空白を潰す', () => {
  const html = '<div>  一行目  </div>\n\n<p>二行目</p><br><span>   </span><li>三行目</li>';
  assert.equal(htmlToText(html), '一行目\n二行目\n三行目');
});

test('filterLines: 当たる行だけ残す（大小文字は無視）', () => {
  const text = ['2026/08/21 ポケモンカード 抽選', '2026/08/27 大雨特別警報への対応', 'GEO ID のご案内'].join('\n');
  assert.equal(filterLines(text, 'ポケモン|抽選'), '2026/08/21 ポケモンカード 抽選');
  assert.equal(filterLines(text, 'geo id'), 'GEO ID のご案内');
  assert.equal(filterLines(text, undefined), text);
  assert.equal(filterLines(text, '該当しない語'), '');
});

test('fetchPage: 1つ目が失敗したら2つ目に落ちる', async () => {
  const calls = [];
  const routes = [
    {
      name: 'direct',
      run: async () => {
        calls.push('direct');
        throw new Error('HTTP 403');
      },
    },
    {
      name: 'jina',
      run: async () => {
        calls.push('jina');
        return { body: '本文', status: 200, kind: 'text' };
      },
    },
  ];
  const got = await fetchPage('https://example.com/', { routes });
  assert.deepEqual(calls, ['direct', 'jina']);
  assert.equal(got.route, 'jina');
  assert.deepEqual(got.failures, ['direct: HTTP 403']);
});

test('fetchPage: 1つ目が成功したら2つ目は呼ばない（外部サービスに URL を渡さない）', async () => {
  const calls = [];
  const routes = [
    { name: 'direct', run: async () => { calls.push('direct'); return { body: 'ok', status: 200, kind: 'html' }; } },
    { name: 'jina', run: async () => { calls.push('jina'); return { body: 'ng', status: 200, kind: 'text' }; } },
  ];
  const got = await fetchPage('https://example.com/', { routes });
  assert.deepEqual(calls, ['direct']);
  assert.equal(got.route, 'direct');
});

test('fetchPage: 空の本文は成功と見なさない', async () => {
  const routes = [
    { name: 'direct', run: async () => ({ body: '   \n ', status: 200, kind: 'html' }) },
    { name: 'jina', run: async () => ({ body: '中身', status: 200, kind: 'text' }) },
  ];
  const got = await fetchPage('https://example.com/', { routes });
  assert.equal(got.route, 'jina');
  assert.deepEqual(got.failures, ['direct: 本文が空でした']);
});

test('fetchPage: 全滅したら経路ごとの理由を持って失敗する', async () => {
  const routes = [
    { name: 'direct', run: async () => { throw new Error('HTTP 403'); } },
    { name: 'jina', run: async () => { throw new Error('HTTP 451'); } },
  ];
  await assert.rejects(
    () => fetchPage('https://example.com/', { routes }),
    (e) => {
      assert.deepEqual(e.failures, ['direct: HTTP 403', 'jina: HTTP 451']);
      assert.match(e.message, /すべての経路で取得できませんでした/);
      return true;
    },
  );
});
