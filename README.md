# Next.js から WordPress Contact Form 7 を API 利用するマニュアル

このドキュメントは、Next.js のフォーム送信を WordPress の Contact Form 7（以下 CF7）に転送し、管理者通知メールと自動返信メールを送れる状態を目指します。

テンプレートとしているので「Use this template」からご利用ください。

## 1. 全体像

この構成は次の流れで動きます。

1. ブラウザの問い合わせフォームで入力して送信する
2. Next.js の API ルート `POST /api/contact` が受け取る
3. API ルートが CF7 用の形式に変換して WordPress REST API に送る
4. CF7 が `mail_sent` を返したら送信成功として画面に表示する

## 2. 必要なもの

最低限必要なのは次です。

1. WordPress サイト（管理画面に入れること）
2. Contact Form 7 プラグイン
3. Node.js 20.9.0 以上（このプロジェクトは Next.js 16 のため）

## 3. このリポジトリで「どこが何をしているか」

主要ファイルは次の通りです。

1. `src/app/page.tsx`
   - 問い合わせページ本体
   - `ContactForm` コンポーネントを表示
2. `src/components/contact-form.tsx`
   - フォーム UI と送信処理（`fetch("/api/contact")`）
   - 成功/失敗メッセージ表示
3. `src/app/api/contact/route.ts`
   - サーバー側 API ルート
   - 入力検証、WordPress API 呼び出し、エラー分岐を担当

## 4. WordPress 側の設定

### 4-1. CF7 フォームを作成

CF7 のフォーム編集で、次の名前を使ってフィールドを作成します。
他生成したフィールドに合わせて控えておいてください。

- `your-name`
- `your-email`
- `your-subject`
- `your-message`

例:

```text
[text* your-name placeholder "お名前"]
[email* your-email placeholder "メールアドレス"]
[text your-subject placeholder "件名"]
[textarea* your-message placeholder "お問い合わせ内容"]
[submit "送信"]
```

注意:

- フィールド名が一致しないと、Next.js 側が送っても CF7 側で期待どおり処理されません。

### 4-2. Form ID を確認

CF7 一覧画面で対象フォームの ID を確認します。
例: `6`

https://yohakutest.com/next_wordpress_test/wp-json/contact-form-7/v1/contact-forms/

上記URLをAPIでGET実行

CF7のフォーム一覧が取得できます。

認証情報はBasic Authとしてユーザーとアプリケーションパスワードを使用して下さい。

この値を後で環境変数として `CF7_FORM_ID` に設定します。

### 4-3. WordPress のアプリケーションパスワード作成

Next.js から WordPress API を認証付きで呼ぶために使います。

1. WordPress 管理画面で対象ユーザーのプロフィールを開く
2. 「アプリケーションパスワード」を新規発行
3. 表示されたパスワードを控える

後で次に入れます。

- `WORDPRESS_API_USER`
- `WORDPRESS_API_PASS`

### 4-4. CF7 のメール設定（管理者通知）

CF7 の「メール」タブで通常の通知メールを設定します。
これが管理者向け通知です。

### 4-5. 自動返信メール設定（ユーザー向け）

CF7 の「メール (2)」を有効化してください。

### 4-6. Google reCAPTCHA v3 のキー発行

1. Google reCAPTCHA 管理画面で `v3` のサイトキー/シークレットキーを発行
2. ドメインに本番ドメインと `localhost` を追加
3. 発行したキーを `.env.local`または `.env` に設定

## 5. Next.js 側の環境変数設定

ローカルで動かす場合は`src/.env.local` を作成して、次を設定します。

本番環境で動かす場合は`.env`に追記して下さい。

```env
WORDPRESS_API_URL=https://your-site.com/wp-json
CF7_FORM_ID=6

WORDPRESS_API_USER=admin
WORDPRESS_API_PASS=xxxx xxxx xxxx xxxx xxxx xxxx

# サーバーの Basic 認証が必要な場合のみ
WORDPRESS_BASIC_AUTH_USER=
WORDPRESS_BASIC_AUTH_PASS=

# 必要時のみ（通常は空でOK）
CF7_UNIT_TAG=

# セキュリティ設定
CONTACT_ALLOWED_ORIGINS=http://localhost:3000
CONTACT_RATE_LIMIT_WINDOW_MS=60000
CONTACT_RATE_LIMIT_MAX=5
CONTACT_MAX_BODY_BYTES=16384
CONTACT_UPSTREAM_TIMEOUT_MS=10000
WORDPRESS_REQUIRE_AUTH=0
WORDPRESS_ALLOW_NOAUTH_RETRY=0
CONTACT_DEBUG=0

# reCAPTCHA v3 設定
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=
RECAPTCHA_REQUIRED=1
RECAPTCHA_MIN_SCORE=0.5
RECAPTCHA_TIMEOUT_MS=8000
```

各変数の意味:

1. `WORDPRESS_API_URL`
   - WordPress API のベース URL
   - `/wp-json` または `/wp-json/wp/v2` どちらでも可（コード側で正規化）
   - 互換のため `NEXT_PUBLIC_WORDPRESS_API_URL` も読めますが、本番では `WORDPRESS_API_URL` を推奨
2. `CF7_FORM_ID`
   - 送信先フォームの ID
3. `WORDPRESS_API_USER` / `WORDPRESS_API_PASS`
   - WordPress REST API 認証（推奨）
4. `WORDPRESS_BASIC_AUTH_USER` / `WORDPRESS_BASIC_AUTH_PASS`
   - サーバー側の Basic 認証があるときに使用
5. `CF7_UNIT_TAG`
   - 通常は未設定で可。必要な場合だけ明示
6. `WORDPRESS_ALLOW_NOAUTH_RETRY`
   - 開発時のみ `1` 推奨。401 後に認証なしで再試行
7. `CONTACT_ALLOWED_ORIGINS`
   - 送信を許可する Origin（カンマ区切り）
8. `CONTACT_RATE_LIMIT_WINDOW_MS` / `CONTACT_RATE_LIMIT_MAX`
   - API のレート制限設定
9. `CONTACT_MAX_BODY_BYTES`
   - 受信ボディ上限
10. `CONTACT_UPSTREAM_TIMEOUT_MS`
   - WordPress API へのタイムアウト
11. `WORDPRESS_REQUIRE_AUTH`
   - `1` の場合、認証未設定だと送信を拒否
12. `CONTACT_DEBUG`
   - `0` 推奨。本番で詳細エラーを返さない
13. `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
   - フロントエンドでトークンを発行するための公開キー
14. `RECAPTCHA_SECRET_KEY`
   - サーバー側で Google 検証に使う秘密鍵
15. `RECAPTCHA_REQUIRED`
   - `1` で reCAPTCHA 必須（推奨）
16. `RECAPTCHA_MIN_SCORE`
   - v3 スコアの許容下限（例: `0.5`）
17. `RECAPTCHA_TIMEOUT_MS`
   - Google 検証 API タイムアウト

## 6. ローカル起動手順

Node バージョンは `20.9.0` 以上が必要です。

```powershell
docker compose build --no-cache app
docker compose up -d
docker compose ps
```

## 7. 送信処理の中身（route.ts の理解）

`src/app/api/contact/route.ts` の主な役割:

1. Origin チェックとレート制限
2. 受信 JSON のサイズ/形式/内容チェック
3. honeypot（`website`）で bot 送信を除外
4. reCAPTCHA トークンを Google API で検証
5. WordPress URL の正規化
6. CF7 用パラメータへ変換
   - `_wpcf7`
   - `_wpcf7_unit_tag`
   - `_wpcf7_container_post`
   - `your-name`
   - `your-email`
   - `your-subject`
   - `your-message`
7. エンドポイント呼び分け
   - `/feedback`
   - `/feedback/`
8. 認証方式の優先順で試行
   - `WORDPRESS_API_USER`
   - `WORDPRESS_BASIC_AUTH`
   - `NO_AUTH`
9. 415 のとき `multipart/form-data` で再送
10. タイムアウト付きで WordPress API 呼び出し
11. 本番では詳細エラーを抑制
12. CF7 応答が `status: mail_sent` なら成功

## 8. まず行う疎通テスト

### 8-1. WordPress 認証テスト

```powershell
curl.exe -u "admin:アプリケーションパスワード" ^
  https://your-site.com/wp-json/wp/v2/users/me
```

`200` なら認証は通っています。

### 8-2. CF7 エンドポイント直叩き

```powershell
curl.exe -X POST ^
  -u "admin:アプリケーションパスワード" ^
  -H "Accept: application/json" ^
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" ^
  -d "_wpcf7=6&_wpcf7_unit_tag=wpcf7-f6-p0-o1&_wpcf7_container_post=0&your-name=test&your-email=test@example.com&your-subject=test&your-message=hello" ^
  https://your-site.com/wp-json/contact-form-7/v1/contact-forms/6/feedback
```

`status: "mail_sent"` が返れば CF7 側は正常です。

## 9. よくあるエラーと対処

1. `401 Unauthorized`
   - ユーザー名/アプリケーションパスワード誤り
2. `403 Forbidden` / `wpcf7_forbidden`
   - 権限不足
3. `404 rest_no_route`
   - URL、フォーム ID、CF7 有効化を確認
4. `415 unsupported_media_type`
   - `Content-Type` や送信形式の不一致
5. `400 wpcf7_unit_tag_not_found`
   - `_wpcf7_unit_tag` 不一致（`CF7_UNIT_TAG` を調整）

## 10. 本番前チェックリスト

1. `.env.local` が Git 管理に入っていないこと
2. 管理者通知メールが届くこと
3. 自動返信メール（メール 2）が届くこと
4. フォーム必須項目チェックが機能すること
5. 失敗時のメッセージがユーザーに分かること
6. `CONTACT_ALLOWED_ORIGINS` と `CONTACT_DEBUG=0` を本番値にすること
7. `WORDPRESS_REQUIRE_AUTH=1` を必要に応じて有効化すること
8. `RECAPTCHA_REQUIRED=1` と `RECAPTCHA_SECRET_KEY` を本番値にすること

---
