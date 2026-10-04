# HANDOFF

最終更新: 2026-10-04（3本目のルーティン「全国オンライン ポケカ抽選チェック」を新設。テスト実行中）

## いま何をしているのか

ポケモンカードの抽選販売を毎朝チェックして LINE へ通知する仕組みの運用。
実体は Claude の**クラウドルーティン**（cloud agent）**3本**で、Anthropic 側に置かれている。**GAS ではない。**

このリポジトリは、**その3本が使うスクリプト**を持つ。全ルーティンとも `sources` にこのリポジトリを
指定していて、実行時に `/home/user/Pokemon-check` へクローンされ、そこがカレントディレクトリになる。

| スクリプト | 役割 |
|---|---|
| `scripts/fetch-page.mjs` | WebFetch が塞がれたページの取得（direct → r.jina.ai の段階式） |
| `scripts/notify-line.mjs` | カード仕様のJSONを受け取り、検証して LINE へ Flex 送信する CLI（`--dry` で送信なし検証） |
| `scripts/flex.mjs` | カード仕様 → Flex JSON の描画層＋検証。**note-blog / ai-katsuyo-lab と同一内容** |

## 通知の実体：ルーティン3本

| | 1 | 2 | 3（2026-10-04 新設） |
|---|---|---|---|
| 名前 | ポケセンオンライン 抽選チェック（毎朝） | 沖縄ポケカ抽選チェック（毎朝） | 全国オンライン ポケカ抽選チェック（毎朝） |
| ID | `trig_018px6XxgxFYbbnHwYMhK4HM` | `trig_013ZrQvVefFT5XZh6Hics5Et` | `trig_01MNkY5QSzUkPEJM1QN4JPsf` |
| 対象 | 公式POLのみ | ポケセンオキナワ / ゲオ / サンエー / イオン(iAEON) | 上記以外で**沖縄から応募できる**全国のオンライン・アプリ抽選 |
| cron(UTC) | `10 23 * * *` = 08:10 JST | `40 23 * * *` = 08:40 JST | `10 0 * * *` = **09:10 JST** |
| カード仕様 | `/tmp/pol_card.json` | `/tmp/oki_card.json` | `/tmp/nat_card.json` |

共通: 環境 `env_01Sn8REJP7KFN8tAz5PLAPJc` / model `claude-sonnet-5` / `persist_session: false`
（状態を持てないので新着判定はプロンプト内のベースライン表）/ LINE は環境変数
`NEXEED_LINE_USER_ID` `NEXEED_LINE_CHANNEL_ACCESS_TOKEN` / 管理画面 https://claude.ai/code/routines/{ID}

**プロンプトはリポジトリに無い。** 各ルーティンの中にだけある。読むときは `RemoteTrigger get`。

### ルーティン3を作った理由と設計

2026-10-03 に利用者の依頼でネット上の抽選を全件調べたところ、ヨドバシ・ドンキ・コジマ・ジョーシン・
DMMマイカ・イオンスタイルオンラインなど、**沖縄からでも応募できる全国のオンライン抽選が通知に乗っていなかった**。
利用者が「拾うようにして」と依頼したので新設した。

- 情報源は**まとめサイト2つ**（`pokeca-navi.jp/lotteries/` 主・`nyuka-now.com/archives/2459` 副）で候補を拾い、
  採用した候補だけ公式で裏取り（1回最大8件）。各社を個別巡回するのは件数的に無理なため
- **採用基準**: A=配送型（Web/アプリ応募→自宅配送）、B=全国チェーンのチェーン全体の抽選（店頭受取。
  「沖縄店舗が対象か要確認」を必ず付ける）。**X応募・店舗単位・地域チェーン・他ルーティン担当分は載せない**
  （まとめサイトの大半は店舗単位の来店抽選で、沖縄からは使えない）
- 既存2本と分けたのは失敗の質が違うため（まとめサイト依存で不確実）。既存2本のプロンプトは触っていない

## 今回やったこと（2026-10-03〜04）

- まとめサイト3つ＋公式（ゲオ・ポケカ公式）で全国の抽選を調査し、利用者に一覧で報告
- `RemoteTrigger create` でルーティン3を作成（上の表）。プロンプトの下書きは作業セッションの scratchpad にあっただけで、リポジトリには置いていない
- プロンプト内のカード例を `node scripts/notify-line.mjs --spec ex.json --dry` で検証 → `OK`
- `RemoteTrigger run` で1回手動実行（session `cse_018YYjQMpHdcifJm3mQYCvgC`）。**LINE を1通消費する**
- `CLAUDE.md` の「ルーティン2本」を「3本」に修正

## 検証済みの事実

- ルーティン3の作成 → `CREATE_TRIGGER_OUTCOME_CREATED`、`next_run_at: 2026-10-05T00:10:00Z`
- カード例の `--dry` 検証 → `OK`
- 手元（日本の回線）から: `pokeca-navi.jp/lotteries/` と `nyuka-now.com/archives/2459` は WebFetch で本文まで取れた
- `pokemoncenter-online.com` は WebFetch（待合室へ302）でも fetch-page（direct 失敗→jina 経由で403「Restricted access」）でも取れない
- `aeonretail.com/Page/k-entry_01.aspx` は WebFetch 403、fetch-page は jina 経由で 200 だがポケカ関連の行が無かった
- ゲオ `news/783`（30th カードセット）・`news/785`（再販）は fetch-page の direct で取得。どちらも応募は **9/28 11:00〜10/1 17:59 で締切済み**
- テスト実行のログ冒頭: サンドボックス起動・リポジトリ取得・`date` 実行（`2026-10-04 16:05 Sun`）まで進んだのを確認

## 未検証のもの

- **ルーティン3のテスト実行が最後まで通ったか（LINE 送信まで）は未確認**（このファイルを書いた時点で実行中）。
  `RemoteTrigger get_run_log` に `cse_018YYjQMpHdcifJm3mQYCvgC` を渡して見る
- まとめサイトがクラウドのサンドボックスから取れるか（手元では取れた）
- 採用基準どおりにふるい分けられるか（X応募・店舗単位を誤って載せないか）
- ゲオの抽選で沖縄の店舗が選べるか（公式に記載なし）
- イオン iAEON 抽選の一次情報（アプリ内のみ）
- `jina` 経路がクラウドから通るか（クラウドでは direct が通るので未使用）

## 次にやること

1. **テスト実行のログを見る**: `RemoteTrigger get_run_log`（session `cse_018YYjQMpHdcifJm3mQYCvgC`）。
   採用件数・不採用の内訳・送信結果を確認し、ここの「未検証」を更新する
2. **10/5 09:10 JST の定時実行を見る**（`RemoteTrigger list_runs` trigger `trig_01MNkY5QSzUkPEJM1QN4JPsf`）。
   ヨドバシ（10/5 11:00〜）が `⏰` 付きで載るはず
3. ベースライン表（ルーティン3のプロンプト内）は 2026-10-04 時点。古くなったら `RemoteTrigger update` で書き換える
4. 12月ごろ POL の 30th CELEBRATION 4回目追加抽選（まとめサイト情報）→ ルーティン1の担当

見た目を直すなら `scripts/flex.mjs` の描画層だけ。直したら `node --test scripts/*.test.mjs` → コミット → push
（ルーティンは push 済みの `main` を clone するので、**push しないと反映されない**）。

## 触ってはいけないところ

- **push しないとルーティンに反映されない**
- **ルーティンの削除はツールからできない。** https://claude.ai/code/routines から手動
- **LINE 無料枠は月200通。** gas-notify-hub 約60＋ルーティン1〜3 各約30＝**約150通/月**。
  手動実行（`RemoteTrigger run`）は1回1通消費する。内容だけ見たいときは `--dry`
- 全ルーティンのプロンプトにある「`HANDOFF.md` を書き換えない・`git commit` / `git push` をしない」を消さない
  （2026-08-27 にルーティンがこのファイルを上書きして push した事故がある。commit `fe0b46f`）
- `fetch-page.mjs` の `jina` 経路にブラウザの UA を渡さない（r.jina.ai が403を返す）。公開ページにだけ使う
- `scripts/flex.mjs` は共通設計書の複製。設計書は gas-notify-hub の `docs/superpowers/specs/2026-08-26-line-flex-design.md`。ズレたら設計書が正
- POL に WebFetch / curl を使わない（待合室で必ず失敗）。ルーティン1は WebSearch `allowed_domains` が唯一の経路
- ルーティン1のプロンプトに「電話番号認証」「未認証枠」の案内を足さない（本人認証済み）
- **サンエー・イオンについて「抽選なし」と書かせない。** 自動確認できないだけ
- 「ポケモンカードストア」の事前抽選（旭川・川口・四條畷・大牟田・沼津のみ）を沖縄の抽選と混同しない
