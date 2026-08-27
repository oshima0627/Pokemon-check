# HANDOFF

最終更新: 2026-08-27

## いま何をしているのか

ポケモンカードの抽選販売を毎朝チェックして LINE へ通知する仕組みの運用。
実体は Claude の**クラウドルーティン**（cloud agent）2本で、Anthropic 側に置かれている。
**GAS ではない**（後述）。

このリポジトリは、**その2本が使う LINE 送信スクリプト**を持つ。両ルーティンとも
`sources` にこのリポジトリを指定していて、実行時に `/home/user/Pokemon-check` へクローンされ、
そこがカレントディレクトリになる（2026-08-27 の実行ログで確認済み）。

## 通知の実体：ルーティン2本

| | ルーティン1 | ルーティン2 |
|---|---|---|
| 名前 | ポケセンオンライン 抽選チェック（毎朝） | 沖縄ポケカ抽選チェック（毎朝） |
| ID | `trig_018px6XxgxFYbbnHwYMhK4HM` | `trig_013ZrQvVefFT5XZh6Hics5Et` |
| 対象 | 公式POL（ポケモンセンターオンライン）のみ | ポケセンオキナワ / ゲオ / サンエー / イオン |
| cron(UTC) | `10 23 * * *` = **08:10 JST** | `40 23 * * *` = **08:40 JST** |
| カード仕様の置き場 | `/tmp/pol_card.json` | `/tmp/oki_card.json` |
| 作成日 | 2026-08-07 | 2026-08-27 |
| enabled | true | true |

共通:
- 環境 `env_01Sn8REJP7KFN8tAz5PLAPJc`（nexeed-lab-article）／ model `claude-sonnet-5`
- `sources`: `https://github.com/oshima0627/Pokemon-check`
- 送信は **Flex Message**。環境変数 `NEXEED_LINE_USER_ID` / `NEXEED_LINE_CHANNEL_ACCESS_TOKEN`
- `persist_session: false`。**状態を持てない**ので、既知/新着の判定はプロンプト内のベースライン表で行う
- 管理画面 https://claude.ai/code/routines/{ID}

**なぜ2本に分けたか**: 失敗の質が違う。POLは1ドメインで確定的、店舗側は複数ソースで不確実。
1本にすると店舗側が詰まった日にPOLの通知まで巻き込んで落ちる。

## LINE 通知の見た目（Flex Message）

共通設計書は **gas-notify-hub の `docs/superpowers/specs/2026-08-26-line-flex-design.md`**。
実装を触る前にそれを読むこと。**ズレたら設計書が正。**

| ファイル | 役割 |
|---|---|
| `scripts/flex.mjs` | カード仕様 → Flex JSON の描画層＋検証。**note-blog/scripts/flex.mjs と同一内容**（設計書の方針どおり複製） |
| `scripts/notify-line.mjs` | カード仕様のJSONファイルを受け取り、検証して送る CLI |
| `scripts/notify-line.test.mjs` | 上2つのテスト |

ルーティンは **Flex の JSON を組み立てない。** カード仕様（`status` / `title` / `subtitle` /
`altText` / `blocks` / `action`）を Write ツールでファイルに書き、次を呼ぶだけ:

```bash
node scripts/notify-line.mjs --spec /tmp/oki_card.json
node scripts/notify-line.mjs --spec /tmp/oki_card.json --dry   # 送信せず内容だけ出す
```

スクリプトが、空 text の除去 → Flex 変換 → 送信前検証 → 失敗時の `altText` テキストへの
フォールバックまで行う。**見た目より通知を失わないことを優先する**（設計書5節）。

status はヘッダの色。**推測させない**ため、各プロンプトに機械的な規則を書いてある:
受付中/開始48時間以内＝`warn`、予定はあるが先＝`info`、進行中なし＝`neutral`、
取得失敗＝`warn`。`success` と `error` は使わせない。

## 各対象の一次情報源（2026-08-27 に実際に取得して確認）

| 対象 | URL | 自動取得 |
|---|---|---|
| 公式POL | WebSearch `allowed_domains: ["pokemoncenter-online.com"]` | ✅ 唯一の経路。**WebFetch / curl は不可**（wr.pokemoncenter-online.com へ302） |
| ポケセンオキナワ | `https://shop.pokemon.co.jp/ja/shop/pokemoncenter-okinawa/news/` | ✅ WebFetch で一覧取得成功 |
| ゲオ | `https://geo-online.co.jp/news/` と `/news/{番号}` | ✅ WebFetch で一覧・詳細とも取得成功 |
| サンエー | 無し | ❌ ポケカ抽選はWebに出ていない。ただし商品により専用ページを作る（例 `san-a.co.jp/topics/switch2/`）。`/topics/` に一覧は無い（404） |
| イオン（沖縄） | 無し | ❌ 九州・沖縄は **iAEONアプリ**（本州・四国のキッズリパブリックとは別窓口）。告知はアプリ内 |

**旧URLの注意**: `voice.pokemon.co.jp/stv/okinawa/` は `shop.pokemon.co.jp` へ301。旧URLを使わない。

**GAS ではない。** `gas-notify-hub`（scriptId `1jnWi27Y...`）は朝レポート・死活監視・問い合わせ通知専用で、
ポケモン関連の記述は1つも無い。Windows タスクスケジューラ・n8n にも無い。

## 検証済みの事実（2026-08-27 に画面へ出した出力）

### 送信スクリプト

`node --test scripts/notify-line.test.mjs`:

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

実際のカード仕様で `--dry` を実行し、`--- 検証 --- OK` と、フォールバック本文・altText の
生成を確認済み。

### ルーティン1（POL）— 8/27 朝の定時実行は成功（Flex 化する前のテキスト版）

```
last_run.status: ROUTINE_RUN_STATUS_SUCCEEDED
✅ LINE送信成功 (try 1): 2026/08/27 08:14
result: success is_error=false turns=12 duration=82s
```
追加抽選の公式発表（news/?id=20260821）を新着として検出。

### ルーティン2（沖縄）— 作成し、テキスト版で1回成功

```
run: session_id=cse_0139Kdy2dyqWoi7of2pqAfNU
✅ LINE送信成功 (try 1): 2026/08/27 15:01
result: success is_error=false turns=20 duration=129s
- ポケセンオキナワ 取得成功〇 / ゲオ 取得成功〇（/news/779, /news/781 の詳細まで）
```

そのとき見つけた欠陥と修正: `wc -m` がこの環境ではバイト数を返すため、実際400字程度の本文を
「1025字」と誤判定して4回削り直し、情報を落としていた。→ Flex 化で文字数を数える必要自体が
無くなった（スクリプトが JSON サイズを検証する）。

### Flex 化後の実行

リポジトリのクローンとカレントディレクトリを実行ログで確認済み:

```
env[info]: Cloning repository oshima0627/Pokemon-check
init: model=claude-sonnet-5 cwd=/home/user/Pokemon-check
```

**Flex での送信は成功した。** そのルーティン自身が実行記録として残した出力（commit `fe0b46f`）:

```
Step2 ポケセンオキナワ WebFetch 〇: ポケカ関連3件検出、最新は7/15分＝新着なし
Step3 ゲオ WebFetch 〇: news/779・news/781 検出。ベースラインと一致（新着なし）
Step4 サンエー WebSearch(san-a.co.jp): ポケカ抽選ページなし（Switch2ページのみ）
Step4 イオン WebSearch: まとめサイトに「ポケカ30周年iAEON抽選｜イオン九州8月30日締切」を発見
  → WebFetch は 403 Forbidden。タイトルの情報のみ、（まとめサイト情報・未裏取り）として掲載
Step6-7 カード status=info、--dry で検証OK を確認後に送信
✅ LINE送信成功 (try 1) 「LINE 通知を送信しました（Flex）」
```

**この実行で、ルーティンが自分で `HANDOFF.md` を書き換えて push してしまった。**
このリポジトリの `CLAUDE.md` の「終わるときに HANDOFF.md を書き直してコミット・push」を
読んで従ったため。`sources` を付けたことで初めて起きた。
→ `CLAUDE.md` にルーティン向けの除外を明記し、両ルーティンのプロンプトにも
「HANDOFF.md を書き換えない・コミットも push もしない」を入れて塞いだ（2026-08-27）。

### 抽選日程（公式ページから直接取得したもの）

| 対象 | 内容 | 期間 | 出典 |
|---|---|---|---|
| POL | 追加抽選＋第2弾（9種セット） | 8/28(金)12:00〜8/31(月)16:59。発表9/4、支払期限9/8 16:59 | POL公式 news/?id=20260821 |
| ゲオ | 30th CELEBRATION／プレミアムデッキセット | 8/31(月)11:00〜9/3(木)17:59 | geo-online.co.jp/news/779 |
| ゲオ | 再販（ストームエメラルダ等／ONE PIECE） | 同上 | geo-online.co.jp/news/781 |
| ポケセンオキナワ | ポケカ抽選の告知なし | — | — |

**混同禁止**: 「ポケモンカードストア」の9/16発売分 事前抽選（8/21 14:00〜9/8 23:59）は
対象が旭川駅前・川口前川・四條畷・大牟田・沼津の5店舗のみで、**沖縄は対象外**（公式で店舗名を確認済み）。

## 未検証のもの

- **Flex 化後の実機の見え方は未確認。** スクリプトの検証が通り、送信が成功したことは確認済みだが、
  LINE アプリでのフォント・行間・折り返しは別物（設計書9節）
- **イオンの iAEON 30周年抽選（8/30締切）はまとめサイト1件のみ。一次情報の裏取りができていない**
  （tinpanblog.com への WebFetch が403で本文を読めず、対象商品・応募方法は不明）
- **ゲオの抽選で沖縄の店舗が選べるかは未確認。** 公式に受取方法・対象店舗の記載が無い
- サンエーのポケカ抽選（8/17〜8/31 17:00）は**まとめサイト由来で未裏取り**
- 「進行中の抽選なし」の日や、取得失敗した日の分岐は未実行（`neutral` / `warn` の見え方が未確認）

## 次にやること

1. **LINE の実機でカードの見え方を確認する**（届いているのは確認済み。見た目だけが未確認）。
   直したくなったら `scripts/flex.mjs` の描画層だけを変える
2. **イオン九州・沖縄の iAEON 抽選「8/30締切」を自分で確認する。**
   まとめサイト1件だけの情報で、一次情報の裏取りができていない（WebFetch が403）。
   iAEON アプリを開いて実物を見るのが唯一の確実な方法
3. **8/28(金)12:00 の POL 応募開始前に、プレイヤーズクラブと POL の登録メールアドレスが完全一致か確認**
   （ドットの有無・位置の違いは不一致扱い）。応募は【本人認証済み枠】から
4. **8/31(月)11:00 のゲオ応募開始時に、沖縄の店舗が選べるか実際の応募画面で確認する**。
   選べないならルーティン2からゲオを外すか「沖縄対象外」と書くようプロンプトを直す
5. サンエーのポケカ抽選（8/31 17:00締切）をアプリで確認する
6. 9/8 以降、ルーティン1が「完全に終了」を垂れ流していないか LINE を見る（告知待ちモードは未検証）

見た目を直したくなったら **`scripts/flex.mjs` の描画層だけ**を変える。
内容（何を出すか）は各ルーティンのプロンプト、見た目は `flex.mjs` と役割が分かれている。
直したら `node --test scripts/notify-line.test.mjs` → コミット → push（ルーティンは push 済みの
main を clone するので、push しないと反映されない）。

## 触ってはいけないところ

- **ルーティンの削除はツールからできない。** 消すなら https://claude.ai/code/routines から手動
- **push しないとルーティンに反映されない。** ローカルのコミットだけでは効かない
- **LINE 無料枠は月200通。** 現在の見込みは gas-notify-hub 約60＋ルーティン1約30＋ルーティン2約30＝**約120通/月**。
  手動実行（`RemoteTrigger run`）は1回1通消費するので、確認のたびに叩かない。
  内容だけ見たいときは `--dry` を使う
- **`scripts/flex.mjs` は共通設計書の複製。** 独自の見た目を足す前に設計書を読み、
  4リポジトリ共通の仕様として妥当か考えること
- LINE のトークンはクラウド側の環境変数。**本文に絶対に含めない**
- POL に WebFetch / curl を使わない。待合室で必ず失敗する
- ルーティン1のプロンプトに「電話番号認証」「未認証枠」の案内を足さない（本人認証済みのため誤誘導になる）
- **サンエー・イオンについて「抽選なし」と書かせない。** 自動確認できないだけで、
  通知が来ない＝抽選が無い ではない
