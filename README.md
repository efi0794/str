# HoYo Daily Status

崩壊：スターレイルの HoYoLAB認証状態 / デイリー訓練 / 開拓力 / 派遣 / HoYoLABログインボーナス を1画面で確認するダッシュボードです。

> 非公式ツールです。HoYoverse / COGNOSPHERE の公式アプリではありません。

## 重要

画面の「認証OK」は HoYoLAB API に認証済みでアクセスできる、という意味です。StarRail.exe が今起動中かどうかを示すものではありません。

## セットアップ

1. Node.js 20以上を入れる
2. リポジトリを clone して npm install
3. .env.example を .env にコピー
4. HoYoLABへログインし、ブラウザの Application > Cookies から ltoken_v2 と ltuid_v2 を確認
5. HSR_UID と一緒に .env に設定
6. npm start
7. http://localhost:3000 を開く

## .env の例

HOYO_LTOKEN_V2=xxxxxxxx
HOYO_LTUID_V2=123456789
HSR_UID=800000000
PORT=3000

本物のHoYoverseパスワードは入力しないでください。CookieをGitHubへコミットしないでください。.env は .gitignore 済みです。

## API

- GET /api/status : 正規化したゲーム状況
- GET /api/health : サーバー起動確認

## 現在の表示

- HoYoLAB認証の有効/無効
- 崩壊：スターレイルの開拓力
- 派遣状況
- HoYoLABログインボーナス
- HoYoLAB API がデイリー訓練スコアを返す場合は完了/未完了

## 次に追加可能

- 原神
- ゼンレスゾーンゼロ
- 複数アカウント
- Discord通知
- 21時になっても未完了なら通知
- PC側の小さな常駐プログラムで『今日ゲームを起動したか』も判定