# HANDOFF

最終更新: 2026-09-05（ゲオの「取得失敗」を直した。取得手順を全URL共通の段階式に置き換え）

## いま何をしているのか

ポケモンカードの抽選販売を毎朝チェックして LINE へ通知する仕組みの運用。
実体は Claude の**クラウドルーティン**（cloud agent）2本で、Anthropic 側に置かれている。
**GAS ではない**（後述）。

このリポジトリは、**その2本が使うスクリプト**を持つ。両ルーティンとも `sources` にこのリポジトリを
指定していて、実行時に `/home/user/Pokemon-check` へクローンされ、そこがカレントディレクトリになる。

| スクリプト | 役割 |
|---|---|
| `scripts/fetch-page.mjs` | **WebFetch が塞がれたページの取得**（2026-09-05 追加） |
| `scripts/notify-line.mjs` | カード仕様のJSONを受け取り、検証して LINE へ Flex 送信する CLI |
| `scripts/flex.mjs` | カード仕様 → Flex JSON の描画層＋検証。**note-blog / ai-katsuyo-lab と同一内容** |

## 通知の実体：ルーティン2本

| | ルーティン1 | ルーティン2 |
|---|---|---|
| 名前 | ポケセンオンライン 抽選チェック（毎朝） | 沖縄ポケカ抽選チェック（毎朝） |
| ID | `trig_018px6XxgxFYbbnHwYMhK4HM` | `trig_013ZrQvVefFT5XZh6Hics5Et` |
| 対象 | 公式POL（ポケモンセンターオンライン）のみ | ポケセンオキナワ / ゲオ / サンエー / イオン |
| cron(UTC) | `10 23 * * *` = **08:10 JST** | `40 23 * * *` = **08:40 JST** |
| カード仕様の置き場 | `/tmp/pol_card.json` | `/tmp/oki_card.json` |

共通:
- 環境 `env_01Sn8REJP7KFN8tAz5PLAPJc`（nexeed-lab-article）／ model `claude-sonnet-5`
- `sources`: `https://github.com/oshima0627/Pokemon-check`
- 送信は **Flex Message**。環境変数 `NEXEED_LINE_USER_ID` / `NEXEED_LINE_CHANNEL_ACCESS_TOKEN`
- `persist_session: false`。**状態を持てない**ので、既知/新着の判定はプロンプト内のベースライン表で行う
- 管理画面 https://claude.ai/code/routines/{ID}

**なぜ2本に分けたか**: 失敗の質が違う。POLは1ドメインで確定的、店舗側は複数ソースで不確実。

## 2026-09-05 に直したこと：ゲオが毎朝「取得失敗」になっていた

### 原因（実測済み）

`geo-online.co.jp` は **Akamai Bot Manager** の後ろにいる（応答に `_abck` / `bm_sz` cookie）。
**WebFetch からの取得に 403 Forbidden を返すようになった。**

- UA は無関係。日本の回線からは、素の curl・空UA・ClaudeBot 名乗り、**どれでも 200**（画面で確認）
- `robots.txt` は `/news/` を禁じていない（禁止は `/store/detail/` `/signage/` `/m/` `/coupon/` `/account/`）
- つまり **IP の評判で弾いている**。同じ URL を WebFetch で叩き直しても直らない
- 9/2 JST の実行は取得成功、9/5 JST の実行は**3回叩いて3回とも403**（実行ログで確認）

### 直し方：サイト個別の回避ではなく、全URL共通の段階式にした

`scripts/fetch-page.mjs`（新規・依存なし）が、**どのURLでも同じ順**で試す:

1. `direct` … ブラウザ相当のヘッダで直接 GET（オリジンのトップを1回叩いて cookie を受けてから本番）
2. `jina` … `https://r.jina.ai/<URL>` 経由（第三者サービス。1が塞がれたときだけ）

リンクは捨てず `見出し (https://…)` の形で本文に残す（一覧から記事URLを拾えないと次の一手が打てない）。
`--grep`（行の絞り込み）・`--max`（文字数）・`--timeout` がある。

ルーティン2のプロンプトも書き換えた。Step 2/3 の「WebFetchで取得」を消し、
**「ページの取得手順（すべてのURLに共通）」** という節を1つ置いて両方がそれを参照する形にした:

1. WebFetch を**1回だけ** → 2. `node scripts/fetch-page.mjs '<URL>'` → 3. WebSearch で `allowed_domains` を絞る
→ 4. 全滅なら ⚠取得失敗（**「抽選なし」とは書かない**）

あわせて入れたもの:
- **同じURLに WebFetch を繰り返さない**（旧プロンプトは3回叩いて3回とも403にしていた）
- 情報源の記号を3段階に: `〇`=本文まで読めた／`△`=タイトルとURLだけ／`⚠`=取得失敗
- 実行ログに**どの段で取れたか**を書かせる（塞がれ方の変化に人間が気づけるように）
- ベースライン表を 2026-09-05 時点に更新（779・781 は9/3で締切済み。780 は遊戯王で対象外）

## 検証済みの事実（2026-09-05 に画面へ出した出力）

### テスト

```
node --test scripts/*.test.mjs
ℹ tests 45   ℹ pass 45   ℹ fail 0
```

（既存 31 件＋`fetch-page.test.mjs` の 14 件。ネットワークは叩かず、経路は差し替えて検証している）

### 手元（日本の回線）から実際に取得

```
node scripts/fetch-page.mjs https://geo-online.co.jp/news/ --grep 'ポケモン|抽選' --max 1500
# 取得成功: direct HTTP 200 https://geo-online.co.jp/news/
2026/08/21 …「30th CELEBRATION」…抽選販売受付のお知らせ (https://geo-online.co.jp/news/779)
2026/08/21 …「遊戯王 ORIGINAL ARTWORKCOLLECTION」…               (https://geo-online.co.jp/news/780)
2026/08/21 「ポケモンカードゲーム」「ONE PIECEカードゲーム」再販商品 … (https://geo-online.co.jp/news/781)
```

`jina` 経路も単独で 200 を確認（`len=19020`）。
**r.jina.ai はブラウザの UA に 403 を返す**（Chrome UA=403 / 素の curl=200）ので、
この経路だけ `fetch-page.mjs/1.0` と名乗っている。ここを Chrome UA に変えると壊れる。

### クラウド側での実行（session `cse_01972Cp6LJEwGb6AmppqtR53`、2026-09-05 11:02 JST）

```
WebFetch geo-online.co.jp/news/ → HTTP 403 Forbidden
node scripts/fetch-page.mjs 'https://geo-online.co.jp/news/' --grep 'ポケモンカード|抽選' --max 4000
  → # 取得成功: direct HTTP 200 （779 / 780 / 781 のURLまで取得）
情報源: ポケセンオキナワ〇／ゲオ〇
LINE 通知を送信しました（Flex） ✅ LINE送信成功 (try 1)
result: success is_error=false turns=11 duration=76s
```

**クラウドのサンドボックスからは `direct` 経路がそのまま通る。** つまり 403 は WebFetch の
取得元IPに対するものだけで、サンドボックスのIPは弾かれていない（`jina` は今回は使われなかった）。
所要時間も 103s → 76s に減った（403を3回叩く無駄が消えたため）。

### ルーティンが HANDOFF を書き換えた事故（2026-08-27）

`sources` を付けた初回の実行で、ルーティンが `CLAUDE.md` を読み、
「終わるときに HANDOFF.md を書き直してコミット・push」に従って**この引き継ぎを上書きして push した**。
塞いだ方法（両方入れてある）:

- `CLAUDE.md` の冒頭に「クラウドルーティンとして動いている場合は適用されない」を明記
- 両ルーティンのプロンプトに「`HANDOFF.md` を書き換えない・`git commit` / `git push` をしない」を明記

**この2つは消さないこと。** 消すと毎朝また上書きされる。

## 各対象の一次情報源

| 対象 | URL | 取得 |
|---|---|---|
| 公式POL | WebSearch `allowed_domains: ["pokemoncenter-online.com"]` | ✅ 唯一の経路。**WebFetch / curl は不可**（待合室へ302） |
| ポケセンオキナワ | `https://shop.pokemon.co.jp/ja/shop/pokemoncenter-okinawa/news/` | ✅ WebFetch で成功（2026-09-05 も成功） |
| ゲオ | `https://geo-online.co.jp/news/` と `/news/{番号}` | ⚠ **WebFetch は403**。`fetch-page.mjs` で取る |
| サンエー | 一覧ページ無し | ❌ 商品ごとに専用ページを作ることがある（例 `san-a.co.jp/topics/switch2/`）。検索経由でしか見つからない |
| イオン（沖縄） | 無し | ❌ 九州・沖縄は **iAEONアプリ**。告知はアプリ内 |

**旧URLの注意**: `voice.pokemon.co.jp/stv/okinawa/` は `shop.pokemon.co.jp` へ301。旧URLを使わない。

**GAS ではない。** `gas-notify-hub` は朝レポート・死活監視・問い合わせ通知専用で、
ポケモン関連の記述は1つも無い。Windows タスクスケジューラ・n8n にも無い。

## 未検証のもの

- **`jina` 経路がクラウドから通るかは未検証。** 手元（日本）からは 200 を確認したが、
  クラウドの実行では `direct` が成功したので `jina` は呼ばれていない。
  ゲオが `direct` も弾くようになった日に初めて試されることになる
- **ボタン3つを1枚に並べたときの見え方は未確認。** 1つ・2つは実機で確認済み
- **ゲオの抽選で沖縄の店舗が選べるかは未確認。** 公式に受取方法・対象店舗の記載が無い
- イオンの iAEON 抽選は一次情報の裏取りができていない（WebFetch が403で本文を読めない）
- 「取得失敗した日」（1〜3が全滅）の分岐は未実行。`⚠` と `△` の見え方は未確認

## 次にやること

1. **9/6 朝の定時実行（08:40 JST）を見る。** 情報源の行が「ゲオ〇」のままか。
   `RemoteTrigger list_runs` → `get_run_log` で確認できる。**手動実行はLINEを1通消費する**ので、
   確認は定時実行のログで足りる
2. **9/16 発売の「MEGA 拡張パック 30th CELEBRATION」に向けた抽選が各社から出るはず。**
   14日前〜発売日は抽選が集中する。新着を拾えているか見る
3. **ゲオの応募開始時に、沖縄の店舗が選べるか実際の応募画面で確認する。**
   選べないならルーティン2からゲオを外すか「沖縄対象外」と書くようプロンプトを直す
4. サンエー・イオンはアプリでしか分からない。本人がアプリで見るしかない
5. ボタン3つ並べたときの詰まり具合を実機で見る

見た目を直したくなったら **`scripts/flex.mjs` の描画層だけ**を変える。
内容（何を出すか）は各ルーティンのプロンプト、見た目は `flex.mjs` と役割が分かれている。
直したら `node --test scripts/*.test.mjs` → コミット → push（ルーティンは push 済みの
`main` を clone するので、**push しないと反映されない**）。

## 触ってはいけないところ

- **push しないとルーティンに反映されない。** ローカルのコミットだけでは効かない
- **ルーティンの削除はツールからできない。** 消すなら https://claude.ai/code/routines から手動
- **LINE 無料枠は月200通。** gas-notify-hub 約60＋ルーティン1約30＋ルーティン2約30＝**約120通/月**。
  手動実行（`RemoteTrigger run`）は1回1通消費する。内容だけ見たいときは `--dry`
- **`fetch-page.mjs` の `jina` 経路にブラウザの UA を渡さない。** r.jina.ai が403を返す
- **`jina` 経路は URL を第三者サービスに渡す。** 公開ページにだけ使うこと。
  ログイン後のページや個人情報を含む URL に使わない
- **`scripts/flex.mjs` は共通設計書の複製。** 設計書は gas-notify-hub の
  `docs/superpowers/specs/2026-08-26-line-flex-design.md`。**ズレたら設計書が正**
- LINE のトークンはクラウド側の環境変数。**本文に絶対に含めない**
- POL に WebFetch / curl を使わない。待合室で必ず失敗する
- ルーティン1のプロンプトに「電話番号認証」「未認証枠」の案内を足さない（本人認証済みのため誤誘導になる）
- **サンエー・イオンについて「抽選なし」と書かせない。** 自動確認できないだけで、
  通知が来ない＝抽選が無い ではない
