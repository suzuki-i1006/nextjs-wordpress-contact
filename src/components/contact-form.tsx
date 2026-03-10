"use client";

import { FormEvent, useEffect, useState } from "react";

type FormState = "idle" | "sending" | "success" | "error";

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
  // bot 判定用の honeypot 項目（通常ユーザーは空のまま）
  const [website, setWebsite] = useState("");
  // 送信状態とメッセージ表示用
  const [status, setStatus] = useState<FormState>("idle");
  const [statusMessage, setStatusMessage] = useState("");

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
        Name
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
        Email
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
        Subject
        <input
          name="subject"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="mt-1 rounded border border-zinc-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col text-sm">
        Message
        <textarea
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
          className="mt-1 rounded border border-zinc-300 px-3 py-2"
          required
        />
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
