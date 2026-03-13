"use client";

import { FormEvent, useEffect, useState } from "react";

type FormState = "idle" | "sending" | "success" | "error";
type ChoiceOption = "選択肢 1" | "選択肢 2" | "選択肢 3";

const SELECT_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const CHECKBOX_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const RADIO_OPTIONS: ChoiceOption[] = ["選択肢 1", "選択肢 2", "選択肢 3"];
const SUCCESS_MESSAGE_AUTO_HIDE_MS = 8000;
const SUCCESS_MESSAGE =
  "お問い合わせありがとうございます。内容を受け付けました。入力いただいたメールアドレス宛に自動返信メールを送信しました。数分経っても届かない場合は、迷惑メールフォルダをご確認ください。";

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

  const closeConfirmModal = () => {
    if (status === "sending") return;
    setIsConfirmOpen(false);
  };

  // モーダル上の「送信する」押下時のみ、実際のAPI送信を実行する
  const handleConfirmSend = async () => {
    if (status === "sending") return;

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

    // 同意未チェックならモーダルを開かずに理由を即時表示する
    if (!accepted) {
      setStatus("error");
      setStatusMessage("プライバシーポリシーに同意してください。");
      return;
    }

    setStatus("idle");
    setStatusMessage("");
    setIsConfirmOpen(true);
  };

  const isSending = status === "sending";

  return (
    <>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-busy={isSending}>
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
