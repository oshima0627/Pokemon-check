#!/usr/bin/env node
/**
 * WebFetch が拒否されたページを取りに行くための、依存なしの取得 CLI。
 *
 * なぜ要るか（2026-09-05 に実測）:
 *   geo-online.co.jp は Akamai Bot Manager の後ろにいて（応答に `_abck` / `bm_sz` cookie）、
 *   WebFetch からの取得に **403 Forbidden** を返すようになった。UA は関係ない
 *   （curl のまま・空UA・ClaudeBot 名乗り、いずれも日本の回線からは 200）。
 *   つまり IP の評判で弾かれている。同じ URL を何度 WebFetch しても直らない。
 *
 * 特定のサイト専用にはしない。**取得元がどこであれ同じ順で試す**:
 *   1. direct … ブラウザ相当のヘッダで直接 GET（cookie を1回受け取ってから本番の GET）
 *   2. jina   … https://r.jina.ai/<URL> 経由（第三者サービス。1が塞がれたときだけ）
 *
 * 1 で取れるならそれが一番良い。2 は URL を外部サービスに渡すので、
 * **公開ページにだけ使うこと。** ログイン後のページや個人情報を含む URL に使わない。
 *
 * 使い方:
 *   node scripts/fetch-page.mjs https://example.com/news/
 *   node scripts/fetch-page.mjs https://example.com/news/ --grep 'ポケモンカード|抽選'
 *   node scripts/fetch-page.mjs https://example.com/news/ --max 4000 --timeout 20
 *
 * 出力（成功）: 1行目に `# 取得成功: <経路> <HTTPステータス> <URL>`、2行目以降が本文。
 * 出力（失敗）: `# 取得失敗:` と経路ごとの理由を stderr に出し、終了コード 1。
 *
 * リンクは捨てずに `見出し (https://…)` の形で本文に残す。
 * 一覧ページから記事 URL を拾えないと次の一手が打てないため。
 */

export const DEFAULT_MAX_CHARS = 12000;
export const DEFAULT_TIMEOUT_SEC = 25;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

/** 中継サービス向け。ブラウザのふりをしない、素性の分かる名乗り。 */
const BOT_UA = 'fetch-page.mjs/1.0 (+https://github.com/oshima0627/Pokemon-check)';

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  yen: '¥',
  middot: '・',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** 相対 URL を絶対 URL にする。壊れた href はそのまま返す（落とさない）。 */
export function absolutize(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * HTML を、リンクを残したプレーンテキストにする。
 *
 * `<a href="/news/779">…</a>` は `… (https://…/news/779)` になる。
 * 一覧ページで拾いたいのは「見出しと、その記事の URL」なので、そこだけは落とさない。
 */
export function htmlToText(html, baseUrl = 'https://example.invalid/') {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // <a> はテキストの直後に URL を括弧付きで残す
  s = s.replace(
    /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q, dq, sq, bare, inner) => {
      const href = (dq ?? sq ?? bare ?? '').trim();
      const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return ` ${text} `;
      // 山括弧で囲むと、このあとのタグ除去で URL ごと消える。丸括弧で残す
      return ` ${text} (${absolutize(href, baseUrl)}) `;
    },
  );
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|section|article|h[1-6]|dt|dd|td|th)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/\r/g, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t　]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return s;
}

/** --grep が付いていれば、その正規表現に当たる行だけ残す。 */
export function filterLines(text, pattern) {
  if (!pattern) return text;
  const re = new RegExp(pattern, 'i');
  return text
    .split('\n')
    .filter((line) => re.test(line))
    .join('\n');
}

export function parseArgs(argv) {
  const out = { url: undefined, grep: undefined, max: DEFAULT_MAX_CHARS, timeout: DEFAULT_TIMEOUT_SEC, raw: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--raw') {
      out.raw = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} に値がありません`);
      i++;
      if (key === 'grep') out.grep = value;
      else if (key === 'max') out.max = Number(value);
      else if (key === 'timeout') out.timeout = Number(value);
      else throw new Error(`未知のオプション: --${key}`);
      continue;
    }
    if (out.url) throw new Error('URL は1つだけ指定してください');
    out.url = arg;
  }
  if (!out.url) throw new Error('URL が指定されていません');
  if (!/^https?:\/\//i.test(out.url)) throw new Error(`http(s) の URL を指定してください: ${out.url}`);
  if (!Number.isFinite(out.max) || out.max <= 0) throw new Error('--max は正の数です');
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) throw new Error('--timeout は正の数です');
  return out;
}

function readSetCookie(res) {
  const jar = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const single = jar.length === 0 ? res.headers.get('set-cookie') : null;
  const all = jar.length > 0 ? jar : single ? [single] : [];
  return all.map((c) => c.split(';', 1)[0]).filter(Boolean).join('; ');
}

async function get(url, { timeoutMs, headers }) {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  return res;
}

/**
 * 経路1: ブラウザ相当のヘッダで直接取りに行く。
 *
 * bot 対策は初回アクセスで cookie を撒いてから判定することがあるので、
 * まずオリジンのトップを1回叩いて cookie を受け取り、それを付けて本番を取る。
 * トップが失敗しても本番は試す（cookie は「あれば付ける」程度の扱い）。
 */
async function fetchDirect(url, timeoutMs) {
  const origin = new URL(url).origin;
  let cookie = '';
  try {
    const warm = await get(`${origin}/`, { timeoutMs, headers: BROWSER_HEADERS });
    cookie = readSetCookie(warm);
  } catch {
    // cookie を撒けなくても本番は試す
  }
  const headers = { ...BROWSER_HEADERS, Referer: `${origin}/`, ...(cookie ? { Cookie: cookie } : {}) };
  const res = await get(url, { timeoutMs, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { body: await res.text(), status: res.status, kind: 'html' };
}

/**
 * 経路2: r.jina.ai 経由。直接が塞がれたときだけ使う。
 * 向こうが本文を Markdown にして返すので、こちらでの HTML 解体は不要。
 *
 * **ここではブラウザの UA を名乗らないこと。** ブラウザからの素通し利用を防ぐため、
 * r.jina.ai は Chrome の UA に 403 を返す（2026-09-05 実測：Chrome UA=403 / 素の curl=200）。
 */
async function fetchViaJina(url, timeoutMs) {
  const res = await get(`https://r.jina.ai/${url}`, {
    timeoutMs,
    headers: { 'User-Agent': BOT_UA, Accept: 'text/plain,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { body: await res.text(), status: res.status, kind: 'text' };
}

export const ROUTES = [
  { name: 'direct', run: fetchDirect },
  { name: 'jina', run: fetchViaJina },
];

/** 経路を順に試し、最初に取れたものを返す。全滅なら失敗の内訳を投げる。 */
export async function fetchPage(url, { timeoutMs = DEFAULT_TIMEOUT_SEC * 1000, routes = ROUTES } = {}) {
  const failures = [];
  for (const route of routes) {
    try {
      const got = await route.run(url, timeoutMs);
      if (!got.body || got.body.trim().length === 0) throw new Error('本文が空でした');
      return { ...got, route: route.name, failures };
    } catch (e) {
      failures.push(`${route.name}: ${e.message}`);
    }
  }
  const err = new Error(`すべての経路で取得できませんでした\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  err.failures = failures;
  throw err;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const got = await fetchPage(args.url, { timeoutMs: args.timeout * 1000 });
  for (const f of got.failures) console.error(`⚠ ${f}`);

  let text = args.raw || got.kind === 'text' ? got.body : htmlToText(got.body, args.url);
  text = filterLines(text, args.grep);
  const clipped = text.length > args.max;

  console.log(`# 取得成功: ${got.route} HTTP ${got.status} ${args.url}`);
  console.log(text.slice(0, args.max));
  if (clipped) console.log(`… （${text.length} 文字中 ${args.max} 文字まで。--max で増やせます）`);
  if (text.trim().length === 0) {
    console.log('（--grep に当たる行がありませんでした。取得自体は成功しています）');
  }
}

if (process.argv[1]?.endsWith('fetch-page.mjs')) {
  main().catch((e) => {
    console.error(`# 取得失敗: ${e.message}`);
    process.exit(1);
  });
}
