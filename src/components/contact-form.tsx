"use client";

import { FormEvent, useState } from "react";

type FormState = "idle" | "sending" | "success" | "error";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<FormState>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setStatus("sending");
    setStatusMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
        }),
      });

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
    } catch (error) {
      setStatus("error");
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Network error occurred.",
      );
    }
  };

  const isSending = status === "sending";

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
