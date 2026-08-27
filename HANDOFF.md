# HANDOFF

最終更新: 2026-08-27

## いま何をしているのか

ポケモンセンターオンライン（POL）の抽選販売を毎朝チェックして LINE へ通知する仕組みの運用。
**このリポジトリにはコードが1行も無い。** 実体は Claude の**クラウドルーティン**（cloud agent）で、
Anthropic 側に置かれている。リポジトリは引き継ぎメモ置き場としてだけ存在している。

## 通知の実体（2026-08-27 に API で確認）

| 項目 | 値 |
|---|---|
| ルーティン名 | ポケセンオンライン 抽選チェック（毎朝） |
| ID | `trig_018px6XxgxFYbbnHwYMhK4HM` |
| 管理画面 | https://claude.ai/code/routines/trig_018px6XxgxFYbbnHwYMhK4HM |
| スケジュール | cron `10 23 * * *`（UTC）＝ **毎朝 08:10 JST** |
| enabled | true |
| モデル / 環境 | claude-sonnet-5 / `env_01Sn8REJP7KFN8tAz5PLAPJc`（nexeed-lab-article） |
| git リポジトリ | 無し（`No sources configured`） |
| 送信経路 | LINE Messaging API `push`。環境変数 `NEXEED_LINE_USER_ID` / `NEXEED_LINE_CHANNEL_ACCESS_TOKEN` |
| 作成 / 最終更新 | 2026-08-07 |

情報取得は **WebSearch に `allowed_domains: ["pokemoncenter-online.com"]` を付ける方法のみ**。
POL は仮想待合室（wr.pokemoncenter-online.com）へ302で飛ばすため WebFetch / curl は使えない（検証済み）。

**GAS ではない。** `gas-notify-hub`（scriptId `1jnWi27Y...`）は朝レポート・死活監視・問い合わせ通知専用で、
ポケモン関連の記述は1つも無い（`projects` 配下を ripgrep して0件）。
Windows タスクスケジューラ・n8n（ワークフローは「LINE × Google Calendar」1本のみ）にも無い。

## 検証済みの事実（2026-08-27 に画面へ出した出力）

`RemoteTrigger get` の結果:

```
enabled: true
cron_expression: 10 23 * * *
last_fired_at: 2026-08-26T23:12:48Z （= 8/27 08:12 JST）
last_run.status: ROUTINE_RUN_STATUS_SUCCEEDED
next_run_at: 2026-08-27T23:10:00Z （= 8/28 08:10 JST）
```

直近の実行ログ（`cse_01Hqy1Kg1kZXrofr3Ay1FVX5`）:

```
2026-08-27 08:12 Thu  現在時刻の確定
WebSearch ×4（ドメイン限定3＋一般1）いずれも結果あり
✅ LINE送信成功 (try 1): 2026/08/27 08:14
result: success is_error=false turns=12 duration=82s
```

- 新着として **追加抽選の公式発表（news/?id=20260821）を検出**。BOX とプレミアムデッキセットが対象
- LINE 本文 523文字（900字上限内）。先頭に `⏰`（受付開始48時間以内）
- LINE に加えて **モバイルプッシュ通知（PushNotification）も1通送っている**

## 現在の抽選日程（8/27 の実行が公式検索で確認した内容）

- 第1弾（3商品）… 応募・注文とも**終了**
- 追加抽選（BOX / プレミアムデッキセット）＋ 第2弾（9種セット）
  … 応募 **8/28(金)12:00〜8/31(月)16:59**、結果発表 9/4(金)、支払期限 9/8(火)16:59
- FUTURISTIC BOX の追加抽選は「検討中・詳細未定」

## 未検証のもの

- **LINE の実機での見え方は確認していない**（API が HTTP 200 を返したことのみ確認）
- プロンプト内のベースライン表は **2026-08-03 時点のスナップショット**。以降の日程は毎回の検索結果に依存する
- 8/31 の受付終了後・9/8 の支払期限後に「告知待ちモード」へ正しく切り替わるかは未確認（Step 5 の分岐は未実行）

## 次にやること

1. **8/28(金)12:00 の応募開始前に、プレイヤーズクラブと POL の登録メールアドレスが完全一致か確認する**
   （ドットの有無・位置の違いは不一致扱い。不一致だと本人認証済みでも落選確定）
2. 応募は必ず **【本人認証済み枠】** から。応募後に一覧が「受付中」→「受付完了」に変わったか確認する
3. 9/8 の支払期限を過ぎたあと、ルーティンが「完全に終了」を垂れ流していないか LINE を見る。
   垂れ流していたら Step 5 の告知待ちモードが効いていないので、プロンプトを直す

ルーティンの確認・変更コマンド（このセッションで使ったもの）:

```bash
# 一覧・詳細・実行ログは RemoteTrigger ツール（/schedule スキル経由でロード）
# get: trigger_id=trig_018px6XxgxFYbbnHwYMhK4HM
```

## 触ってはいけないところ

- **ルーティンの削除はツールからできない。** 消すなら https://claude.ai/code/routines から手動
- LINE のトークンはクラウド側の環境変数。**本文に絶対に含めない**（プロンプトにも明記済み）
- POL に WebFetch / curl を使わない。待合室で必ず失敗する
- プロンプトに「電話番号認証」「未認証枠」の案内を足さない（本人認証済みのため、書くと誤誘導になる）
