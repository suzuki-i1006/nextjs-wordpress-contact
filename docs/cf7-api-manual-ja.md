# Next.js から WordPress Contact Form 7 を API 送信する手順（初心者向け）

このドキュメントは、Next.js のお問い合わせフォームから WordPress（Contact Form 7）へ API 送信するための手順です。  
「まず何を設定すればいいか」「Insomniaでどう確認するか」を順番にまとめています。

## 1. 先に準備するもの

- WordPress サイト（Contact Form 7 をインストール済み）
- Contact Form 7 のフォームを1つ作成済み
- WordPress の管理者ユーザー
- Next.js プロジェクト

## 2. WordPress 側の準備

### 2-1. フォームIDを確認

Contact Form 7 のフォーム一覧で、対象フォームの ID（例: `6`）を確認します。  
この値を `CF7_FORM_ID` に使います。
https://yohakutest.com/next_wordpress_test/wp-json/contact-form-7/v1/contact-forms/
をGETでフォームの一覧を取得できます。対象IDを控えてください。
Authでアプリパスワードで認証してください。

### 2-2. アプリケーションパスワードを作成

1. WordPress 管理画面で対象ユーザー（例: `admin`）のプロフィールを開く  
2. 「アプリケーションパスワード」を新規作成  
3. 発行されたパスワードを控える

## 3. Next.js の環境変数設定（`.env.local`）

```env
NEXT_PUBLIC_WORDPRESS_API_URL=https://your-site.com/wp-json
CF7_FORM_ID=6

# WordPress REST API 認証（必須）
WORDPRESS_API_USER=admin
WORDPRESS_API_PASS=xxxx xxxx xxxx xxxx xxxx xxxx

# サーバー側 Basic 認証がある場合のみ設定
WORDPRESS_BASIC_AUTH_USER=
WORDPRESS_BASIC_AUTH_PASS=
```

注意:
- `WORDPRESS_API_PASS` は WordPress の「アプリケーションパスワード」です
- `.env.local` を変更したら Next.js を再起動します

## 4. API エンドポイント仕様

送信先:

```text
POST /wp-json/contact-form-7/v1/contact-forms/{CF7_FORM_ID}/feedback
```

今回の実装では、以下を送ります。

- `_wpcf7`
- `_wpcf7_unit_tag`
- `_wpcf7_container_post`
- `your-name`
- `your-email`
- `your-subject`
- `your-message`

## 5. Insomnia で動作確認する手順

## 5-1. 認証確認（先にこれ）

1. Method: `GET`  
2. URL: `https://your-site.com/wp-json/wp/v2/users/me`  
3. Auth: `Basic`
   - Username: `admin`
   - Password: アプリケーションパスワード
4. Send

`200` でユーザー情報が返れば認証OKです。

## 5-2. Contact Form 7 送信確認

1. Method: `POST`  
2. URL: `https://your-site.com/wp-json/contact-form-7/v1/contact-forms/6/feedback`  
3. Auth: 上と同じ `Basic`  
4. Body: `Form URL Encoded`  
5. 以下のキーを追加

- `_wpcf7`: `6`
- `_wpcf7_unit_tag`: `wpcf7-f6-p0-o1`
- `_wpcf7_container_post`: `0`
- `your-name`: `test`
- `your-email`: `test@example.com`
- `your-subject`: `test`
- `your-message`: `Hello`

Headers:
- `Accept: application/json`

補足:
- `Content-Type` は Body の設定に合わせて Insomnia に自動設定させるのが安全です
- 手入力で `Content-Type` を固定すると `415` の原因になります

## 6. よくあるエラーと原因

`401 Unauthorized`
- アプリケーションパスワードが違う
- `Authorization` ヘッダーが正しく付いていない

`403 wpcf7_forbidden`
- 認証は通っているが権限不足（ユーザー/権限を確認）

`404 rest_no_route`
- URL が違う
- メソッドが `POST` 以外
- `CF7_FORM_ID` が間違っている

`415 wpcf7_unsupported_media_type`
- 送信形式が CF7 想定外
- `Form URL Encoded` または `multipart/form-data` で送る

`400 wpcf7_unit_tag_not_found`
- `_wpcf7_unit_tag` が不足

## 7. 本番運用チェックリスト

- `GET /wp-json/wp/v2/users/me` が 200
- `/feedback` で `status: mail_sent` が返る
- `.env.local` の秘密情報を公開しない
- 失敗時レスポンス（`message`, `details`）をログで確認できるようにする

