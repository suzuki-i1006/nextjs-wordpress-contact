"use client";

import { FormEvent, useEffect, useState } from "react";

type FormState = "idle" | "sending" | "success" | "error";
type ChoiceOption = "選択肢 1" | "選択肢 2" | "選択肢 3";

const SELECT_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const CHECKBOX_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const RADIO_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];

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

  // フォーム送信ハンドラ
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    // 送信開始時に状態を初期化
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
      setStatusMessage(payload.message || "Sent successfully.");
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

  const isSending = status === "sending";

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 rounded border border-zinc-300 px-3 py-2"
          required
        />
      </label>
      <label className="flex flex-col text-sm">
        メールアドレス
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 rounded border border-zinc-300 px-3 py-2"
          required
        />
      </label>
      <label className="flex flex-col text-sm">
        題名
        <input
          name="subject"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="mt-1 rounded border border-zinc-300 px-3 py-2"
          required
        />
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
          name="url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="mt-1 rounded border border-zinc-300 px-3 py-2"
          placeholder="https://example.com"
        />
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
          type="checkbox"
          name="accepted"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>プライバシーポリシーに同意して下さい。</span>
      </label>

      <button
        type="submit"
        disabled={isSending}
        className="rounded bg-black px-5 py-2 text-white disabled:opacity-50"
      >
        {isSending ? "Sending..." : "Send"}
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
    </form>
  );
}
