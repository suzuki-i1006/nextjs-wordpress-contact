"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type FormState = "idle" | "sending" | "success" | "error";
type ChoiceOption = "選択肢 1" | "選択肢 2" | "選択肢 3";
type ValidatedFieldKey = "name" | "email" | "subject" | "url" | "accepted";
type FocusFieldKey = ValidatedFieldKey | "radio";
type FieldErrors = Partial<Record<ValidatedFieldKey, string>>;

const SELECT_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const CHECKBOX_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const RADIO_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const VALIDATED_FIELDS: ValidatedFieldKey[] = [
  "name",
  "email",
  "subject",
  "url",
  "accepted",
];
const SUCCESS_MESSAGE_AUTO_HIDE_MS = 8000;
const SUCCESS_MESSAGE =
  "お問い合わせありがとうございます。内容を受け付けました。入力いただいたメールアドレス宛に自動返信メールを送信しました。数分経っても届かない場合は、迷惑メールフォルダをご確認ください。";
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

// Google が挿入する grecaptcha オブジェクトの最小型定義
type RecaptchaWindow = Window & {
  grecaptcha?: {
    ready: (callback: () => void) => void;
    execute: (siteKey: string, options: { action: string }) => Promise<string>;
  };
};

// script タグの重複挿入防止用 ID
const RECAPTCHA_SCRIPT_ID = "google-recaptcha-v3";
// サーバー側で期待する action 名と合わせる
const RECAPTCHA_ACTION = "contact_submit";

// reCAPTCHA スクリプトを読み込み済みにする
const loadRecaptchaScript = async (siteKey: string): Promise<void> => {
  if (!siteKey || typeof window === "undefined") return;

  const existing = document.getElementById(RECAPTCHA_SCRIPT_ID);
  if (existing) return;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = RECAPTCHA_SCRIPT_ID;
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load reCAPTCHA script"));
    document.head.appendChild(script);
  });
};

// reCAPTCHA v3 トークンを取得
const getRecaptchaToken = async (
  siteKey: string,
  action: string,
): Promise<string> => {
  await loadRecaptchaScript(siteKey);

  const recaptchaWindow = window as RecaptchaWindow;
  if (!recaptchaWindow.grecaptcha) {
    throw new Error("reCAPTCHA is not available");
  }

  return new Promise<string>((resolve, reject) => {
    recaptchaWindow.grecaptcha?.ready(() => {
      recaptchaWindow.grecaptcha
        ?.execute(siteKey, { action })
        .then(resolve)
        .catch(reject);
    });
  });
};

// 問い合わせフォームの UI と送信処理を担当するコンポーネント
export default function ContactForm() {
  // 公開キー（クライアントで使用してよいキー）
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

  // 入力値の状態
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [numberValue, setNumberValue] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [selectValue, setSelectValue] = useState("");
  const [checkboxValues, setCheckboxValues] = useState<string[]>([]);
  const [radioValue, setRadioValue] = useState("");
  const [accepted, setAccepted] = useState(false);
  // bot 判定用の honeypot 項目（通常ユーザーは空のまま）
  const [website, setWebsite] = useState("");
  // 送信状態とメッセージ表示用
  const [status, setStatus] = useState<FormState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<ValidatedFieldKey, boolean>>
  >({});

  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const acceptedInputRef = useRef<HTMLInputElement>(null);

  const validateField = (
    field: ValidatedFieldKey,
    value: string | boolean,
  ): string => {
    switch (field) {
      case "name": {
        const text = String(value).trim();
        if (!text) return "氏名を入力してください。";
        return "";
      }
      case "email": {
        const text = String(value).trim();
        if (!text) return "メールアドレスを入力してください。";
        if (!EMAIL_REGEX.test(text)) {
          return "メールアドレスの形式が正しくありません。";
        }
        return "";
      }
      case "subject": {
        const text = String(value).trim();
        if (!text) return "題名を入力してください。";
        return "";
      }
      case "url": {
        const text = String(value).trim();
        if (!text) return "";
        try {
          const parsed = new URL(text);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return "リンクは http/https のURLを入力してください。";
          }
        } catch {
          return "リンクの形式が正しくありません。";
        }
        return "";
      }
      case "accepted": {
        if (!value) return "プライバシーポリシーに同意してください。";
        return "";
      }
      default:
        return "";
    }
  };

  const updateFieldError = (
    field: ValidatedFieldKey,
    value: string | boolean,
  ) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      const error = validateField(field, value);
      if (error) {
        next[field] = error;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const collectValidationErrors = (): FieldErrors => {
    const errors: FieldErrors = {};

    const nameError = validateField("name", name);
    if (nameError) errors.name = nameError;

    const emailError = validateField("email", email);
    if (emailError) errors.email = emailError;

    const subjectError = validateField("subject", subject);
    if (subjectError) errors.subject = subjectError;

    const urlError = validateField("url", url);
    if (urlError) errors.url = urlError;

    const acceptedError = validateField("accepted", accepted);
    if (acceptedError) errors.accepted = acceptedError;

    return errors;
  };

  const focusField = (field: FocusFieldKey) => {
    const target =
      field === "name"
        ? nameInputRef.current
        : field === "email"
          ? emailInputRef.current
          : field === "subject"
            ? subjectInputRef.current
            : field === "url"
              ? urlInputRef.current
              : field === "radio"
                ? firstRadioRef.current
                : acceptedInputRef.current;

    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus();
  };

  const markAllValidatedFieldsTouched = () => {
    setTouchedFields({
      name: true,
      email: true,
      subject: true,
      url: true,
      accepted: true,
    });
  };

  // チェックボックスの選択状態をトグル
  const toggleCheckboxValue = (value: ChoiceOption) => {
    setCheckboxValues((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  };

  // 初回表示時に reCAPTCHA スクリプトを先読みし、送信時の待ち時間を減らす
  useEffect(() => {
    if (!recaptchaSiteKey) return;
    loadRecaptchaScript(recaptchaSiteKey).catch(() => {
      // 送信時に再度取得を試みるため、ここでは握りつぶす
    });
  }, [recaptchaSiteKey]);

  // 送信成功メッセージは指定秒数後に自動で消す
  useEffect(() => {
    if (status !== "success" || !statusMessage) return;

    const timeoutId = window.setTimeout(() => {
      setStatusMessage("");
      setStatus("idle");
    }, SUCCESS_MESSAGE_AUTO_HIDE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [status, statusMessage]);

  // サーバーエラー文言から該当項目を推測し、該当入力へ移動する
  useEffect(() => {
    if (status !== "error" || !statusMessage) return;

    const target =
      statusMessage.includes("氏名")
        ? "name"
        : statusMessage.includes("メールアドレス")
          ? "email"
          : statusMessage.includes("題名")
            ? "subject"
            : statusMessage.includes("リンク")
              ? "url"
              : statusMessage.includes("ラジオボタン")
                ? "radio"
                : statusMessage.includes("プライバシーポリシー") ||
                    statusMessage.includes("同意")
                  ? "accepted"
                  : null;

    if (target) {
      focusField(target);
    }
  }, [status, statusMessage]);

  const closeConfirmModal = () => {
    if (status === "sending") return;
    setIsConfirmOpen(false);
  };

  // モーダル上の「送信する」押下時のみ、実際のAPI送信を実行する
  const handleConfirmSend = async () => {
    if (status === "sending") return;

    const errors = collectValidationErrors();
    const firstErrorField = VALIDATED_FIELDS.find((field) => !!errors[field]);
    if (firstErrorField) {
      setFieldErrors(errors);
      markAllValidatedFieldsTouched();
      setStatus("error");
      setStatusMessage("入力内容を確認してください。");
      setIsConfirmOpen(false);
      focusField(firstErrorField);
      return;
    }

    if (!accepted) {
      setStatus("error");
      setStatusMessage("プライバシーポリシーに同意してください。");
      return;
    }

    setIsConfirmOpen(false);
    setStatus("sending");
    setStatusMessage("");

    try {
      // reCAPTCHA キーがある場合のみトークンを取得
      // （開発時にキー未設定でもフォーム自体は動かせる設計）
      let recaptchaToken = "";
      if (recaptchaSiteKey) {
        recaptchaToken = await getRecaptchaToken(
          recaptchaSiteKey,
          RECAPTCHA_ACTION,
        );
      }

      // Next.js の API ルートへ送信（WordPress への転送はサーバー側で実施）
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          website,
          // サーバー側で Google 検証するために token/action を渡す
          recaptchaToken,
          recaptchaAction: RECAPTCHA_ACTION,
        }),
      });

      // API 応答を評価し、成功/失敗を UI に反映
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        setStatus("error");
        setStatusMessage(payload?.message || "Submission failed.");
        return;
      }

      setStatus("success");
      setStatusMessage(payload.message || SUCCESS_MESSAGE);
      setFieldErrors({});
      setTouchedFields({});
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setUrl("");
      setPhone("");
      setNumberValue("");
      setDateValue("");
      setSelectValue("");
      setCheckboxValues([]);
      setRadioValue("");
      setAccepted(false);
      setWebsite("");
    } catch (error) {
      // ネットワークエラーや reCAPTCHA 取得失敗などの例外
      setStatus("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Network error occurred.",
      );
    }
  };

  // フォーム送信ハンドラ（ここでは確認モーダルを開くのみ）
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (status === "sending") return;

    const errors = collectValidationErrors();
    const firstErrorField = VALIDATED_FIELDS.find((field) => !!errors[field]);
    if (firstErrorField) {
      setFieldErrors(errors);
      markAllValidatedFieldsTouched();
      setStatus("error");
      setStatusMessage("入力内容を確認してください。");
      focusField(firstErrorField);
      return;
    }

    // 同意未チェックならモーダルを開かずに理由を即時表示する
    if (!accepted) {
      setStatus("error");
      setStatusMessage("プライバシーポリシーに同意してください。");
      return;
    }

    setStatus("idle");
    setStatusMessage("");
    setFieldErrors({});
    setIsConfirmOpen(true);
  };

  const isSending = status === "sending";

  return (
    <>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-6 space-y-4"
        aria-busy={isSending}
      >
        <fieldset disabled={isSending} className="space-y-4">
          {/* bot が埋めやすい隠し項目（埋まっていたらサーバー側で破棄） */}
          <input
            name="website"
            type="text"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden"
          />
          <label className="flex flex-col text-sm">
            氏名
            <input
              ref={nameInputRef}
              name="name"
              type="text"
              value={name}
              onChange={(event) => {
                const value = event.target.value;
                setName(value);
                if (touchedFields.name) {
                  updateFieldError("name", value);
                }
              }}
              onBlur={() => {
                setTouchedFields((prev) => ({ ...prev, name: true }));
                updateFieldError("name", name);
              }}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
              required
            />
            {fieldErrors.name ? (
              <p id="name-error" className="mt-1 text-xs text-red-700">
                {fieldErrors.name}
              </p>
            ) : null}
          </label>
          <label className="flex flex-col text-sm">
            メールアドレス
            <input
              ref={emailInputRef}
              name="email"
              type="email"
              value={email}
              onChange={(event) => {
                const value = event.target.value;
                setEmail(value);
                if (touchedFields.email) {
                  updateFieldError("email", value);
                }
              }}
              onBlur={() => {
                setTouchedFields((prev) => ({ ...prev, email: true }));
                updateFieldError("email", email);
              }}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              required
            />
            {fieldErrors.email ? (
              <p id="email-error" className="mt-1 text-xs text-red-700">
                {fieldErrors.email}
              </p>
            ) : null}
          </label>
          <label className="flex flex-col text-sm">
            題名
            <input
              ref={subjectInputRef}
              name="subject"
              type="text"
              value={subject}
              onChange={(event) => {
                const value = event.target.value;
                setSubject(value);
                if (touchedFields.subject) {
                  updateFieldError("subject", value);
                }
              }}
              onBlur={() => {
                setTouchedFields((prev) => ({ ...prev, subject: true }));
                updateFieldError("subject", subject);
              }}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
              aria-invalid={Boolean(fieldErrors.subject)}
              aria-describedby={fieldErrors.subject ? "subject-error" : undefined}
              required
            />
            {fieldErrors.subject ? (
              <p id="subject-error" className="mt-1 text-xs text-red-700">
                {fieldErrors.subject}
              </p>
            ) : null}
          </label>
          <label className="flex flex-col text-sm">
            メッセージ本文（任意）
            <textarea
              name="message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={6}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            リンク
            <input
              ref={urlInputRef}
              name="url"
              type="url"
              value={url}
              onChange={(event) => {
                const value = event.target.value;
                setUrl(value);
                if (touchedFields.url) {
                  updateFieldError("url", value);
                }
              }}
              onBlur={() => {
                setTouchedFields((prev) => ({ ...prev, url: true }));
                updateFieldError("url", url);
              }}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
              aria-invalid={Boolean(fieldErrors.url)}
              aria-describedby={fieldErrors.url ? "url-error" : undefined}
              placeholder="https://example.com"
            />
            {fieldErrors.url ? (
              <p id="url-error" className="mt-1 text-xs text-red-700">
                {fieldErrors.url}
              </p>
            ) : null}
          </label>
          <label className="flex flex-col text-sm">
            電話番号
            <input
              name="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            数値
            <input
              name="numberValue"
              type="number"
              value={numberValue}
              onChange={(event) => setNumberValue(event.target.value)}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            日付
            <input
              name="dateValue"
              type="date"
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            ドロップダウン
            <select
              name="selectValue"
              value={selectValue}
              onChange={(event) => setSelectValue(event.target.value)}
              className="mt-1 rounded border border-zinc-300 px-3 py-2"
            >
              <option value="">選択してください</option>
              {SELECT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">チェックボックス</legend>
            {CHECKBOX_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="checkboxValues"
                  value={option}
                  checked={checkboxValues.includes(option)}
                  onChange={() => toggleCheckboxValue(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">ラジオボタン</legend>
            {RADIO_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input
                  ref={option === RADIO_OPTIONS[0] ? firstRadioRef : undefined}
                  type="radio"
                  name="radioValue"
                  value={option}
                  checked={radioValue === option}
                  onChange={(event) => setRadioValue(event.target.value)}
                />
                <span>{option}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              ref={acceptedInputRef}
              type="checkbox"
              name="accepted"
              checked={accepted}
              onChange={(event) => {
                const checked = event.target.checked;
                setAccepted(checked);
                if (touchedFields.accepted) {
                  updateFieldError("accepted", checked);
                }
              }}
              onBlur={() => {
                setTouchedFields((prev) => ({ ...prev, accepted: true }));
                updateFieldError("accepted", accepted);
              }}
              aria-invalid={Boolean(fieldErrors.accepted)}
              aria-describedby={fieldErrors.accepted ? "accepted-error" : undefined}
            />
            <span>プライバシーポリシーに同意して下さい。</span>
          </label>
          {fieldErrors.accepted ? (
            <p id="accepted-error" className="-mt-2 text-xs text-red-700">
              {fieldErrors.accepted}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSending}
            className="rounded bg-black px-5 py-2 text-white disabled:opacity-50"
          >
            {isSending ? "送信中..." : "内容を確認する"}
          </button>

          {statusMessage ? (
            <p
              className={
                status === "success"
                  ? "text-sm text-green-700"
                  : "text-sm text-red-700"
              }
            >
              {statusMessage}
            </p>
          ) : null}
        </fieldset>
      </form>

      {isConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            className="w-full max-w-2xl rounded bg-white p-5 shadow-xl"
          >
            <h2 id="confirm-modal-title" className="text-lg font-semibold">
              送信内容の確認
            </h2>
            <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto rounded border border-zinc-200 p-3 text-sm">
              <p>
                <span className="font-medium">氏名:</span> {name || "-"}
              </p>
              <p>
                <span className="font-medium">メールアドレス:</span>{" "}
                {email || "-"}
              </p>
              <p>
                <span className="font-medium">題名:</span> {subject || "-"}
              </p>
              <p>
                <span className="font-medium">メッセージ本文:</span>{" "}
                {message || "-"}
              </p>
              <p>
                <span className="font-medium">リンク:</span> {url || "-"}
              </p>
              <p>
                <span className="font-medium">電話番号:</span> {phone || "-"}
              </p>
              <p>
                <span className="font-medium">数値:</span> {numberValue || "-"}
              </p>
              <p>
                <span className="font-medium">日付:</span> {dateValue || "-"}
              </p>
              <p>
                <span className="font-medium">ドロップダウン:</span>{" "}
                {selectValue || "-"}
              </p>
              <p>
                <span className="font-medium">チェックボックス:</span>{" "}
                {checkboxValues.length > 0 ? checkboxValues.join(" / ") : "-"}
              </p>
              <p>
                <span className="font-medium">ラジオボタン:</span>{" "}
                {radioValue || "-"}
              </p>
              <p>
                <span className="font-medium">同意:</span>{" "}
                {accepted ? "同意済み" : "未同意"}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={isSending}
                className="rounded border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={handleConfirmSend}
                disabled={isSending}
                className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {isSending ? "送信中..." : "送信する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSending ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            role="status"
            aria-live="polite"
            className="w-full max-w-sm rounded bg-white p-6 text-center shadow-xl"
          >
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-zinc-300 border-t-black" />
            <p className="mt-4 text-sm font-medium text-zinc-800">
              送信中です。しばらくお待ちください。
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
