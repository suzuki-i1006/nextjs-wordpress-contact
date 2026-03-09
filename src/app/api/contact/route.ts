import { NextRequest, NextResponse } from "next/server";

type ContactPayload = {
  name: string;
  email: string;
  subject?: string;
  message: string;
};

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

const buildBasicHeader = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

const buildUnitTag = (formId: string, explicitUnitTag: string): string => {
  if (explicitUnitTag) return explicitUnitTag;
  return `wpcf7-f${formId}-p0-o1`;
};

const buildCf7Body = (formId: string, unitTag: string, payload: ContactPayload): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("_wpcf7", formId);
  params.set("_wpcf7_unit_tag", unitTag);
  params.set("_wpcf7_container_post", "0");
  params.set("your-name", payload.name);
  params.set("your-email", payload.email);
  params.set("your-subject", payload.subject || "");
  params.set("your-message", payload.message);
  return params;
};

type AttemptRecord = {
  option: string;
  endpoint: string | null;
  response: Response | null;
  payload: unknown;
};

const sendWithOptions = async (
  endpoints: string[],
  options: Array<{ label: string; headers: Record<string, string> }>,
  body: BodyInit,
): Promise<AttemptRecord> => {
  let fallback: AttemptRecord | null = null;

  for (const option of options) {
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, {
        method: "POST",
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

      if (response.status !== 404 && response.status !== 401 && response.status !== 403) {
        return attempt;
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
    const payload = (await request.json()) as ContactPayload;

    const baseUrl = (process.env.NEXT_PUBLIC_WORDPRESS_API_URL || "").trim();
    const formId = (process.env.CF7_FORM_ID || "").trim();
    const basicUser = (process.env.WORDPRESS_BASIC_AUTH_USER || "").trim();
    const basicPass = (process.env.WORDPRESS_BASIC_AUTH_PASS || "").trim();
    const apiUser = (process.env.WORDPRESS_API_USER || "").trim();
    const apiPass = (process.env.WORDPRESS_API_PASS || "").trim();
    const cf7UnitTag = (process.env.CF7_UNIT_TAG || "").trim();
    const allowRetryWithoutAuth = process.env.WORDPRESS_ALLOW_NOAUTH_RETRY === "1";

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

    if (!payload?.name || !payload?.email || !payload?.message) {
      return NextResponse.json(
        {
          success: false,
          message: "お名前、メールアドレス、メッセージは必須です。",
        },
        { status: 400 },
      );
    }

    const apiBase = normalizeWordPressBase(baseUrl);
    const endpoints = [
      `${apiBase}/contact-form-7/v1/contact-forms/${formId}/feedback`,
      `${apiBase}/contact-form-7/v1/contact-forms/${formId}/feedback/`,
    ];

    const commonHeaders: Record<string, string> = {
      Accept: "application/json",
    };

    const options: Array<{ label: string; headers: Record<string, string> }> = [];

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
      options.push({
        label: "NO_AUTH",
        headers: { ...commonHeaders },
      });
    }

    const resolvedUnitTag = buildUnitTag(formId, cf7UnitTag);
    const params = buildCf7Body(formId, resolvedUnitTag, payload);
    const multipart = new FormData();
    for (const [key, value] of params.entries()) {
      multipart.set(key, value);
    }

    let attempt = await sendWithOptions(endpoints, options, multipart);

    if (attempt.response && attempt.response.status === 415) {
      const urlencodedOptions = options.map(({ label, headers }) => ({
        label: `${label}_URLENCODED`,
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      }));
      attempt = await sendWithOptions(endpoints, urlencodedOptions, params.toString());
    }

    if (
      attempt.response &&
      attempt.response.status === 401 &&
      allowRetryWithoutAuth
    ) {
      attempt = await sendWithOptions(endpoints, [{ label: "NO_AUTH", headers: commonHeaders }], params.toString());
    }

    const { response, payload: wpPayload, endpoint, option } = attempt;

    if (!response) {
      return NextResponse.json(
        {
          success: false,
          message:
            "WordPress API が見つかりませんでした。wp-json と Form ID を確認してください。",
          details: {
            endpoints,
            baseUrl,
            optionsUsed: options.map((x) => x.label),
          },
        },
        { status: 502 },
      );
    }

    if (!response.ok) {
      const status = response.status;

      if (status === 401) {
        return NextResponse.json(
          {
            success: false,
            message:
              "WordPress が 401 Unauthorized を返しました。WordPress API 用の認証情報（アプリケーションパスワード）かサーバー認証を確認してください。",
            status,
            endpoint,
            authOption: option,
            retryWithoutAuth: allowRetryWithoutAuth,
            details: wpPayload,
          },
          { status: 502 },
        );
      }

      if (status === 403) {
        return NextResponse.json(
          {
            success: false,
            message:
              "WordPress が 403 Forbidden を返しました。WordPress ユーザーの権限（CF7 REST の参照・送信権限）が不足しています。",
            status,
            endpoint,
            authOption: option,
            details: wpPayload,
          },
          { status: 502 },
        );
      }

      if (
        status === 404 &&
        typeof wpPayload === "object" &&
        wpPayload !== null &&
        "message" in wpPayload &&
        String((wpPayload as { message?: unknown }).message).includes("No route was found")
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Contact Form 7 REST ルートが見つかりません。フォームID、プラグインの有効化、REST API 公開設定を確認してください。",
            status,
            endpoint,
            authOption: option,
            details: wpPayload,
          },
          { status: 502 },
        );
      }

      return NextResponse.json(
        {
          success: false,
          message:
            typeof wpPayload === "object" && wpPayload !== null && "message" in wpPayload
              ? String(
                  (wpPayload as { message?: unknown }).message ||
                    "WordPress API がエラーを返しました。",
                )
              : "WordPress API がエラーを返しました。",
          status,
          endpoint,
          authOption: option,
          details: wpPayload,
        },
        { status: 502 },
      );
    }

    const result = wpPayload as Record<string, unknown> | null;
    const isSent =
      !!result &&
      typeof result === "object" &&
      "status" in result &&
      String(result.status) === "mail_sent";

    if (!isSent) {
      return NextResponse.json(
        {
          success: false,
          message:
            result && typeof result === "object" && "message" in result
              ? String(
                  (result as { message?: unknown }).message ||
                    "メール送信に失敗しました。",
                )
              : "メール送信に失敗しました。",
          status: result && "status" in result ? String((result as { status?: unknown }).status) : null,
          endpoint,
          authOption: option,
          details: result,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "メールを送信しました。",
        status: "mail_sent",
        endpoint,
        authOption: option,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "サーバー内部でエラーが発生しました。",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
