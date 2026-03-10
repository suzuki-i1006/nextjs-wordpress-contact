import { NextRequest, NextResponse } from "next/server";

// Node.js ランタイムで動かし、Buffer など Node API を確実に使えるようにする
export const runtime = "nodejs";

// クライアントから受け取る生データ（未検証）
type ContactPayload = {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  url?: unknown;
  phone?: unknown;
  numberValue?: unknown;
  dateValue?: unknown;
  selectValue?: unknown;
  checkboxValues?: unknown;
  radioValue?: unknown;
  accepted?: unknown;
  website?: unknown; // honeypot
  recaptchaToken?: unknown;
  recaptchaAction?: unknown;
};

// バリデーション済みデータ（この型以降は安全に扱う）
type ValidContactPayload = {
  name: string;
  email: string;
  subject: string;
  message: string;
  url: string;
  phone: string;
  numberValue: string;
  dateValue: string;
  selectValue: string;
  checkboxValues: string[];
  radioValue: string;
  accepted: boolean;
};

// WordPress 送信試行の結果
type AttemptRecord = {
  option: string;
  endpoint: string | null;
  response: Response | null;
  payload: unknown;
};

// Google siteverify 応答の必要項目
type RecaptchaVerifyPayload = {
  success?: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

// CF7 バリデーション失敗時の項目情報（必要最小限）
type Cf7InvalidField = {
  into?: unknown;
  name?: unknown;
  message?: unknown;
};

// IP ごとのレート制限カウンタ
type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// セキュリティ関連の設定値（環境変数 + 安全な既定値）
const RATE_LIMIT_WINDOW_MS = clampNumber(
  Number(process.env.CONTACT_RATE_LIMIT_WINDOW_MS || "60000"),
  10_000,
  10 * 60 * 1000,
  60_000,
);
const RATE_LIMIT_MAX = clampNumber(
  Number(process.env.CONTACT_RATE_LIMIT_MAX || "5"),
  1,
  100,
  5,
);
const MAX_BODY_SIZE_BYTES = clampNumber(
  Number(process.env.CONTACT_MAX_BODY_BYTES || "16384"),
  1024,
  1024 * 1024,
  16_384,
);
const FETCH_TIMEOUT_MS = clampNumber(
  Number(process.env.CONTACT_UPSTREAM_TIMEOUT_MS || "10000"),
  1000,
  60_000,
  10_000,
);

const RECAPTCHA_TIMEOUT_MS = clampNumber(
  Number(process.env.RECAPTCHA_TIMEOUT_MS || "8000"),
  1000,
  30_000,
  8000,
);
// v3 判定スコアの下限（0.0〜1.0）
const RECAPTCHA_MIN_SCORE = clampFloat(
  Number(process.env.RECAPTCHA_MIN_SCORE || "0.5"),
  0,
  1,
  0.5,
);
// 1 のとき reCAPTCHA を必須化
const RECAPTCHA_REQUIRED = process.env.RECAPTCHA_REQUIRED === "1";
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
// フロント側と action 名を一致させる
const RECAPTCHA_EXPECTED_ACTION = "contact_submit";

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_URL_LENGTH = 2048;
const MAX_PHONE_LENGTH = 50;
const MAX_NUMBER_LENGTH = 50;
const MAX_DATE_LENGTH = 50;
const MAX_SELECT_LENGTH = 100;
const MAX_RADIO_LENGTH = 100;
const MAX_CHECKBOX_COUNT = 10;
const MAX_CHECKBOX_ITEM_LENGTH = 100;
const CF7_ACCEPTANCE_FIELD = "acceptance-643";

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

const rateLimitStore = new Map<string, RateLimitEntry>();

const debugMode =
  process.env.CONTACT_DEBUG === "1" || process.env.NODE_ENV !== "production";

// 数値設定が壊れていても安全な範囲に収める
function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return Math.floor(value);
}

function clampFloat(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// 本番では内部情報を返さず、開発時のみ debug を付ける
function withDebug<T extends Record<string, unknown>>(
  body: T,
  debug: Record<string, unknown>,
): T | (T & { debug: Record<string, unknown> }) {
  if (!debugMode) return body;
  return { ...body, debug };
}

// 受け取った WordPress URL を /wp-json 形式にそろえる
const normalizeWordPressBase = (raw: string): string => {
  const withoutTrailingSlash = raw.replace(/\/$/, "");
  if (/\/wp-json\/wp\/v2$/.test(withoutTrailingSlash)) {
    return withoutTrailingSlash.replace(/\/wp-json\/wp\/v2$/, "/wp-json");
  }
  if (withoutTrailingSlash.endsWith("/wp-json")) {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}/wp-json`;
};

// Basic 認証ヘッダ生成
const buildBasicHeader = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

// unit_tag 未指定時の既定値を生成
const buildUnitTag = (formId: string, explicitUnitTag: string): string => {
  if (explicitUnitTag) return explicitUnitTag;
  return `wpcf7-f${formId}-p0-o1`;
};

// Next.js 側の入力を CF7 送信用パラメータへ変換
const buildCf7Body = (
  formId: string,
  unitTag: string,
  payload: ValidContactPayload,
): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("_wpcf7", formId);
  params.set("_wpcf7_unit_tag", unitTag);
  params.set("_wpcf7_container_post", "0");
  params.set("your-name", payload.name);
  params.set("your-email", payload.email);
  params.set("your-subject", payload.subject);
  params.set("your-message", payload.message);
  params.set("url-25", payload.url);
  params.set("tel-868", payload.phone);
  params.set("number-833", payload.numberValue);
  params.set("date-537", payload.dateValue);
  params.set("select-946", payload.selectValue);
  if (payload.checkboxValues.length > 0) {
    for (const item of payload.checkboxValues) {
      params.append("checkbox-148", item);
    }
  }
  params.set("radio-203", payload.radioValue);
  params.set(CF7_ACCEPTANCE_FIELD, payload.accepted ? "1" : "");
  return params;
};

// クライアント IP をヘッダから抽出
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

// メモリ肥大化を避けるため、古いレート制限キーを間引く
function pruneRateLimitStore(now: number): void {
  if (rateLimitStore.size <= 5000) return;
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

// IP + UA 単位で送信回数を制限
function checkRateLimit(key: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  pruneRateLimitStore(now);

  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { limited: false, retryAfterSec: 0 };
  }

  current.count += 1;
  rateLimitStore.set(key, current);

  if (current.count > RATE_LIMIT_MAX) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000),
    );
    return { limited: true, retryAfterSec };
  }

  return { limited: false, retryAfterSec: 0 };
}

// CORS/CSRF 的な不正送信を抑えるため Origin を検証
function isOriginAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowed = (process.env.CONTACT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (allowed.length > 0) {
    return allowed.includes(origin);
  }

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// 受信文字列を正規化（改行統一 + trim）
function normalizeField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

// 制御文字を弾いて想定外入力を減らす
function hasDangerousControlChars(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeField(item))
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const normalized = normalizeField(value);
    return normalized ? [normalized] : [];
  }
  return [];
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "on";
  }
  if (typeof value === "number") return value === 1;
  return false;
}

function isAcceptanceInvalid(invalidFields: unknown): boolean {
  if (!Array.isArray(invalidFields)) return false;
  return invalidFields.some((field) => {
    if (!field || typeof field !== "object") return false;
    const record = field as Cf7InvalidField;
    const into = typeof record.into === "string" ? record.into : "";
    const name = typeof record.name === "string" ? record.name : "";
    return into.includes(CF7_ACCEPTANCE_FIELD) || name === CF7_ACCEPTANCE_FIELD;
  });
}

function resolveCf7FailureMessage(result: Record<string, unknown> | null): string {
  if (!result || typeof result !== "object") {
    return "メール送信に失敗しました。";
  }

  const status = typeof result.status === "string" ? result.status : "";
  const message = typeof result.message === "string" ? result.message : "";
  const invalidFields = result.invalid_fields;

  // 同意チェック未選択時のメッセージを明示する
  if (status === "validation_failed" && isAcceptanceInvalid(invalidFields)) {
    return "プライバシーポリシーに同意してください。";
  }

  // CF7 が返すメッセージがあれば優先して返す
  if (message) return message;

  if (status === "validation_failed") {
    return "入力内容に不備があります。";
  }

  return "メール送信に失敗しました。";
}

// 必須/形式/長さ/禁止文字をまとめて検証
function validatePayload(raw: ContactPayload): {
  ok: true;
  value: ValidContactPayload;
} | {
  ok: false;
  message: string;
} {
  const name = normalizeField(raw.name);
  const email = normalizeField(raw.email).toLowerCase();
  const subject = normalizeField(raw.subject);
  const message = normalizeField(raw.message || "");
  const url = normalizeField(raw.url || "");
  const phone = normalizeField(raw.phone || "");
  const numberValue = normalizeField(raw.numberValue || "");
  const dateValue = normalizeField(raw.dateValue || "");
  const selectValue = normalizeField(raw.selectValue || "");
  const checkboxValues = normalizeStringArray(raw.checkboxValues);
  const radioValue = normalizeField(raw.radioValue || "");
  const accepted = normalizeBoolean(raw.accepted);

  if (!name || !email || !subject) {
    return {
      ok: false,
      message: "お名前、メールアドレス、題名は必須です。",
    };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, message: "メールアドレスの形式が不正です。" };
  }

  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { ok: false, message: "リンクは http/https のURLを入力してください。" };
      }
    } catch {
      return { ok: false, message: "リンクの形式が不正です。" };
    }
  }

  if (
    name.length > MAX_NAME_LENGTH ||
    email.length > MAX_EMAIL_LENGTH ||
    subject.length > MAX_SUBJECT_LENGTH ||
    message.length > MAX_MESSAGE_LENGTH ||
    url.length > MAX_URL_LENGTH ||
    phone.length > MAX_PHONE_LENGTH ||
    numberValue.length > MAX_NUMBER_LENGTH ||
    dateValue.length > MAX_DATE_LENGTH ||
    selectValue.length > MAX_SELECT_LENGTH ||
    radioValue.length > MAX_RADIO_LENGTH
  ) {
    return {
      ok: false,
      message: "入力文字数が上限を超えています。",
    };
  }

  if (
    hasDangerousControlChars(name) ||
    hasDangerousControlChars(email) ||
    hasDangerousControlChars(subject) ||
    hasDangerousControlChars(message) ||
    hasDangerousControlChars(url) ||
    hasDangerousControlChars(phone) ||
    hasDangerousControlChars(numberValue) ||
    hasDangerousControlChars(dateValue) ||
    hasDangerousControlChars(selectValue) ||
    hasDangerousControlChars(radioValue)
  ) {
    return { ok: false, message: "入力に使用できない文字が含まれています。" };
  }

  if (checkboxValues.length > MAX_CHECKBOX_COUNT) {
    return { ok: false, message: "チェックボックスの選択数が多すぎます。" };
  }
  for (const item of checkboxValues) {
    if (item.length > MAX_CHECKBOX_ITEM_LENGTH || hasDangerousControlChars(item)) {
      return { ok: false, message: "チェックボックスの入力が不正です。" };
    }
  }

  return {
    ok: true,
    value: {
      name,
      email,
      subject,
      message,
      url,
      phone,
      numberValue,
      dateValue,
      selectValue,
      checkboxValues,
      radioValue,
      accepted,
    },
  };
}

// WordPress API / Google API 呼び出しにタイムアウトを付ける
async function fetchWithTimeout(
  endpoint: string,
  options: { headers: Record<string, string>; body: BodyInit },
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// reCAPTCHA v3 トークンを Google に問い合わせて検証
async function verifyRecaptcha(params: {
  token: string;
  action: string;
  secret: string;
  ip: string;
}): Promise<{ ok: true } | { ok: false; status: 400 | 500 | 502; message: string; debug?: Record<string, unknown> }> {
  const { token, action, secret, ip } = params;

  // シークレットキー未設定だと Google 検証できない
  if (!secret) {
    return {
      ok: false,
      status: 500,
      message: "サーバー設定エラー: reCAPTCHA 秘密鍵が未設定です。",
    };
  }

  // トークン未送信（フロント側で取得失敗含む）
  if (!token) {
    return {
      ok: false,
      status: 400,
      message: "reCAPTCHA の確認に失敗しました。ページを再読み込みして再試行してください。",
    };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip !== "unknown") {
    // 任意: 送信元 IP を Google 側評価に利用
    body.set("remoteip", ip);
  }

  try {
    const response = await fetchWithTimeout(
      RECAPTCHA_VERIFY_URL,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json",
        },
        body: body.toString(),
      },
      RECAPTCHA_TIMEOUT_MS,
    );

    const payload = (await response.json().catch(() => null)) as
      | RecaptchaVerifyPayload
      | null;

    if (!response.ok || !payload) {
      return {
        ok: false,
        status: 502,
        message: "reCAPTCHA の検証に失敗しました。時間をおいて再試行してください。",
        debug: { responseStatus: response.status, payload },
      };
    }

    // Google が success=false を返した場合
    if (!payload.success) {
      return {
        ok: false,
        status: 400,
        message: "reCAPTCHA の確認に失敗しました。再試行してください。",
        debug: { payload },
      };
    }

    // action 不一致は token 使い回し等の異常として扱う
    if (payload.action && payload.action !== action) {
      return {
        ok: false,
        status: 400,
        message: "reCAPTCHA の検証に失敗しました。再試行してください。",
        debug: { expectedAction: action, actualAction: payload.action, payload },
      };
    }

    // score が閾値未満なら bot 疑いとして拒否
    if (
      typeof payload.score === "number" &&
      payload.score < RECAPTCHA_MIN_SCORE
    ) {
      return {
        ok: false,
        status: 400,
        message:
          "送信が bot と判定されました。時間をおいて再試行してください。",
        debug: { minScore: RECAPTCHA_MIN_SCORE, score: payload.score, payload },
      };
    }

    return { ok: true };
  } catch (error) {
    // Google API 側のネットワーク/タイムアウト系エラー
    return {
      ok: false,
      status: 502,
      message: "reCAPTCHA の検証に失敗しました。時間をおいて再試行してください。",
      debug: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// 認証方式とエンドポイントを順に試し、最初に使える結果を採用
const sendWithOptions = async (
  endpoints: string[],
  options: Array<{ label: string; headers: Record<string, string> }>,
  body: BodyInit,
): Promise<AttemptRecord> => {
  let fallback: AttemptRecord | null = null;

  for (const option of options) {
    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          headers: option.headers,
          body,
        });
        const payload = await response.json().catch(() => null);
        const attempt: AttemptRecord = {
          option: option.label,
          endpoint,
          response,
          payload,
        };
        fallback = attempt;

        if (
          response.status !== 404 &&
          response.status !== 401 &&
          response.status !== 403
        ) {
          return attempt;
        }
      } catch (error) {
        fallback = {
          option: option.label,
          endpoint,
          response: null,
          payload:
            error instanceof Error
              ? { error: error.name, message: error.message }
              : { error: "UnknownError" },
        };
      }
    }
  }

  if (fallback) {
    return fallback;
  }

  return {
    option: options[options.length - 1]?.label || "none",
    endpoint: endpoints[endpoints.length - 1] || null,
    response: null,
    payload: null,
  };
};

export async function POST(request: NextRequest) {
  try {
    // 1) 受信サイズ制限
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, message: "リクエストサイズが大きすぎます。" },
        { status: 413 },
      );
    }

    // 2) Origin チェック
    if (!isOriginAllowed(request)) {
      return NextResponse.json(
        { success: false, message: "許可されていない送信元です。" },
        { status: 403 },
      );
    }

    // 3) レート制限
    const ip = getClientIp(request);
    const rateKey = `${ip}:${request.headers.get("user-agent") || "unknown"}`;
    const rate = checkRateLimit(rateKey);
    if (rate.limited) {
      return NextResponse.json(
        {
          success: false,
          message:
            "短時間の送信回数が上限を超えました。しばらく待ってから再試行してください。",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSec) },
        },
      );
    }

    // 4) JSON 受信と型チェック
    const raw = (await request.json().catch(() => null)) as ContactPayload | null;
    if (!raw || typeof raw !== "object") {
      return NextResponse.json(
        { success: false, message: "リクエスト形式が不正です。" },
        { status: 400 },
      );
    }

    // 5) honeypot（bot 判定）
    const honeypot = normalizeField(raw.website);
    if (honeypot) {
      return NextResponse.json(
        { success: true, message: "メールを送信しました。" },
        { status: 200 },
      );
    }

    // 6) 入力バリデーション
    const validated = validatePayload(raw);
    if (!validated.ok) {
      return NextResponse.json(
        { success: false, message: validated.message },
        { status: 400 },
      );
    }
    const payload = validated.value;

    // 7) reCAPTCHA 入力の正規化
    // action は未送信時に既定値へフォールバック
    const recaptchaToken = normalizeField(raw.recaptchaToken);
    const recaptchaAction =
      normalizeField(raw.recaptchaAction) || RECAPTCHA_EXPECTED_ACTION;

    // 8) 環境変数の読み込み
    const baseUrl = (
      process.env.WORDPRESS_API_URL ||
      process.env.NEXT_PUBLIC_WORDPRESS_API_URL ||
      ""
    ).trim();
    const formId = (process.env.CF7_FORM_ID || "").trim();
    const basicUser = (process.env.WORDPRESS_BASIC_AUTH_USER || "").trim();
    const basicPass = (process.env.WORDPRESS_BASIC_AUTH_PASS || "").trim();
    const apiUser = (process.env.WORDPRESS_API_USER || "").trim();
    const apiPass = (process.env.WORDPRESS_API_PASS || "").trim();
    const cf7UnitTag = (process.env.CF7_UNIT_TAG || "").trim();
    const recaptchaSecret = (process.env.RECAPTCHA_SECRET_KEY || "").trim();
    const allowRetryWithoutAuth =
      process.env.NODE_ENV !== "production" &&
      process.env.WORDPRESS_ALLOW_NOAUTH_RETRY === "1";
    const requireAuth = process.env.WORDPRESS_REQUIRE_AUTH === "1";

    // 9) 必須設定の存在確認
    if (!baseUrl || !formId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "WordPress API URL または Contact Form 7 フォームIDが未設定です。",
        },
        { status: 500 },
      );
    }

    // 10) reCAPTCHA 必須時、Google 検証を実行
    // - RECAPTCHA_REQUIRED=1: 常に必須
    // - secret 設定済み: 事実上有効として検証
    if (RECAPTCHA_REQUIRED || recaptchaSecret) {
      const verification = await verifyRecaptcha({
        token: recaptchaToken,
        action: recaptchaAction,
        secret: recaptchaSecret,
        ip,
      });
      if (!verification.ok) {
        return NextResponse.json(
          withDebug(
            {
              success: false,
              message: verification.message,
            },
            verification.debug || {},
          ),
          { status: verification.status },
        );
      }
    }

    // 11) WordPress 送信先候補を組み立て
    const apiBase = normalizeWordPressBase(baseUrl);
    const endpoints = [
      `${apiBase}/contact-form-7/v1/contact-forms/${formId}/feedback`,
      `${apiBase}/contact-form-7/v1/contact-forms/${formId}/feedback/`,
    ];

    const commonHeaders: Record<string, string> = {
      Accept: "application/json",
    };

    // 12) 利用可能な認証方式を優先順で列挙
    const options: Array<{ label: string; headers: Record<string, string> }> =
      [];

    if (apiUser && apiPass) {
      options.push({
        label: "WORDPRESS_API_USER",
        headers: {
          ...commonHeaders,
          Authorization: buildBasicHeader(apiUser, apiPass),
        },
      });
    }

    if (basicUser && basicPass) {
      options.push({
        label: "WORDPRESS_BASIC_AUTH",
        headers: {
          ...commonHeaders,
          Authorization: buildBasicHeader(basicUser, basicPass),
        },
      });
    }

    if (options.length === 0) {
      if (requireAuth) {
        return NextResponse.json(
          {
            success: false,
            message:
              "サーバー設定エラー: 認証必須ですが認証情報が未設定です。",
          },
          { status: 500 },
        );
      }
      // 認証情報がない場合のみ NO_AUTH を使う
      options.push({
        label: "NO_AUTH",
        headers: { ...commonHeaders },
      });
    }

    // 13) CF7 送信用パラメータ作成
    const resolvedUnitTag = buildUnitTag(formId, cf7UnitTag);
    const params = buildCf7Body(formId, resolvedUnitTag, payload);

    const urlencodedOptions = options.map(({ label, headers }) => ({
      label: `${label}_URLENCODED`,
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
    }));

    // 14) まずは URL Encoded で送信
    let attempt = await sendWithOptions(
      endpoints,
      urlencodedOptions,
      params.toString(),
    );

    // 15) CF7 側が 415 を返したら multipart/form-data で再送
    if (attempt.response && attempt.response.status === 415) {
      const multipart = new FormData();
      for (const [key, value] of params.entries()) {
        multipart.set(key, value);
      }
      attempt = await sendWithOptions(endpoints, options, multipart);
    }

    // 16) 開発時のみ、401 のとき無認証再試行を許可
    if (
      attempt.response &&
      attempt.response.status === 401 &&
      allowRetryWithoutAuth
    ) {
      attempt = await sendWithOptions(
        endpoints,
        [{ label: "NO_AUTH", headers: commonHeaders }],
        params.toString(),
      );
    }

    const { response, payload: wpPayload, endpoint, option } = attempt;

    // 17) WordPress 到達不可
    if (!response) {
      return NextResponse.json(
        withDebug(
          {
            success: false,
            message:
              "現在メールを送信できません。しばらくしてから再試行してください。",
          },
          {
            endpoint,
            option,
            details: wpPayload,
          },
        ),
        { status: 502 },
      );
    }

    // 18) WordPress がエラー応答
    if (!response.ok) {
      const status = response.status;
      const genericMessage =
        "現在メールを送信できません。入力内容を確認し、時間をおいて再試行してください。";

      return NextResponse.json(
        withDebug(
          {
            success: false,
            message: genericMessage,
            status,
          },
          {
            endpoint,
            option,
            details: wpPayload,
            retryWithoutAuth: allowRetryWithoutAuth,
          },
        ),
        { status: 502 },
      );
    }

    // 19) CF7 の成功ステータス判定
    const result = wpPayload as Record<string, unknown> | null;
    const isSent =
      !!result &&
      typeof result === "object" &&
      "status" in result &&
      String(result.status) === "mail_sent";

    if (!isSent) {
      const failureMessage = resolveCf7FailureMessage(result);
      return NextResponse.json(
        withDebug(
          {
            success: false,
            message: failureMessage,
          },
          {
            endpoint,
            option,
            details: result,
          },
        ),
        { status: 422 },
      );
    }

    // 20) 正常終了
    return NextResponse.json(
      {
        success: true,
        message: "メールを送信しました。",
        status: "mail_sent",
      },
      { status: 200 },
    );
  } catch (error) {
    // 21) 想定外エラー
    return NextResponse.json(
      withDebug(
        {
          success: false,
          message: "サーバー内部でエラーが発生しました。",
        },
        {
          error: error instanceof Error ? error.message : String(error),
        },
      ),
      { status: 500 },
    );
  }
}
