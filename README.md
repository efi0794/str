# HoYo Daily Status — Cloudflare Multi-user Edition

崩壊：スターレイル / 原神 / ゼンレスゾーンゼロ の日課を、複数ユーザーで使えるWebアプリです。

主な機能:

- Cloudflare Workersで公開
- Cloudflare D1でユーザー・設定を保存
- 新規登録 / ログイン
- ユーザーごとに3ゲームのUIDを登録
- HoYoLABの ltoken_v2 / ltuid_v2 をAES-256-GCMで暗号化して保存
- Discord Webhookも暗号化して保存
- 毎日21:00 JSTに、明確な未完了デイリーがある人だけDiscord通知
- 元のローカルNode.js版は legacy-node ブランチに保存

> 非公式ツールです。HoYoverse / COGNOSPHERE / Cloudflare / Discord の公式アプリではありません。

## 1. 必要なもの

- Cloudflareアカウント
- Node.js 20以上
- Git
- このGitHubリポジトリ

## 2. リポジトリを取得

    git clone https://github.com/efi0794/str.git
    cd str
    npm install

すでにclone済みなら:

    git pull
    npm install

## 3. Cloudflareへログイン

    npx wrangler login

ブラウザが開くのでCloudflareとの接続を許可します。

## 4. D1データベースを作成

    npx wrangler d1 create hoyo-daily-status --location apac

実行結果に database_id が表示されます。

wrangler.jsonc の

    "database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"

を、表示されたIDに置き換えてください。

## 5. D1テーブルを作る

    npm run db:migrate:remote

migrations/0001_init.sql が適用されます。

## 6. 暗号化用MASTER_KEYを作る

次のコマンドで32バイトのランダムキーをBase64で生成します。

    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

表示された値をコピーしてから:

    npx wrangler secret put MASTER_KEY

値の入力を求められたら、コピーしたBase64文字列を貼り付けます。

重要: このMASTER_KEYを失うと、保存済みHoYoLABトークンとDiscord Webhookを復号できません。GitHubには保存しないでください。

## 7. 友達だけに登録させる場合（推奨）

公開URLを知っている誰でも登録できる状態にしたくない場合は、招待コードを設定します。

    npx wrangler secret put REGISTRATION_CODE

好きな長めの招待コードを登録してください。

設定すると、新規登録画面で招待コードが必須になります。
設定しなければ新規登録は誰でも可能です。

## 8. デプロイ

    npm run deploy

成功すると、Cloudflareから workers.dev の公開URLが表示されます。

例:

    https://hoyo-daily-status.xxxxx.workers.dev

このURLを友達へ共有できます。

## 9. アプリの使い方

### 新規登録

1. 公開URLを開く
2. 新規登録を選ぶ
3. メールアドレスと10文字以上のパスワードを入力
4. 招待コードを設定している場合は招待コードも入力

### HoYoLAB認証を登録

1. HoYoLABへブラウザでログイン
2. F12 → Application → Storage → Cookies
3. ltoken_v2 と ltuid_v2 を確認
4. アプリ右上の設定へ入力

HoYoverseのパスワードそのものは入力しません。

### ゲームUIDを登録

設定画面で以下を登録します。

- 崩壊：スターレイル UID
- 原神 UID
- ゼンレスゾーンゼロ UID

遊んでいないゲームは空欄でOKです。

### Discord通知

Discordの通知先チャンネルで:

1. チャンネル設定
2. 連携サービス
3. ウェブフック
4. 新しいウェブフック
5. Webhook URLをコピー
6. アプリの設定画面へ貼り付け
7. Discordテスト送信で確認

## 10. 21時通知

Cloudflare Cron TriggerはUTC基準です。

wrangler.jsonc では次のCronを設定しています。

    0 12 * * *

12:00 UTC = 21:00 JST です。

毎日21時に全ユーザーを確認し、明確に未完了のゲームが1つ以上あるユーザーだけDiscordへ通知します。

- 全部完了 → 通知なし
- 判定不能だけ → 通知なし
- 未完了あり → 通知
- 同じ日に同じユーザーへ二重通知しないようD1に送信ログを保存

## 11. ローカル開発

まず .dev.vars.example を .dev.vars にコピーします。

Windows:

    copy .dev.vars.example .dev.vars

macOS / Linux:

    cp .dev.vars.example .dev.vars

.dev.vars に MASTER_KEY を設定します。

D1のローカルDBを準備:

    npm run db:migrate:local

起動:

    npm run dev

Wranglerが表示するローカルURLを開きます。

Cronのローカルテストは npm run dev 後に、別ターミナルから:

    curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"

## 12. セキュリティ設計

- パスワードはPBKDF2-SHA256でハッシュ化し、平文保存しません
- HoYoLAB TokenはAES-256-GCMで暗号化
- Discord WebhookもAES-256-GCMで暗号化
- 暗号鍵はCloudflare Secretの MASTER_KEY にのみ保存
- セッションCookieは HttpOnly / Secure / SameSite=Lax
- APIの更新系リクエストはsame-originを確認
- 保存済みトークン/Webhookはフロント画面へ再送信しません

### 公開範囲について

現在の実装は、友達・知人へ共有する小規模サービス向けです。

不特定多数へ大規模公開する場合は、さらに以下を推奨します。

- Cloudflare Turnstile
- ログイン試行回数制限
- 独自ドメイン
- 利用規約 / プライバシーポリシー
- アカウント削除機能

## 13. 元のPC常駐版へ戻したい場合

元のExpress + node-cron版は legacy-node ブランチへ保存しています。

    git switch legacy-node

Cloudflare版へ戻る場合:

    git switch main

## 注意

HoYoLABは一般向けの安定した公式公開APIではなく、仕様変更で取得できなくなる可能性があります。とくにスターレイルのデイリー訓練スコアは、API応答によって判定不能になる場合があります。その場合は誤通知防止のため未完了扱いにしません。
