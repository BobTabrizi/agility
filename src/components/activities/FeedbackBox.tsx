"use client";

import { useState, type FormEvent } from "react";
import type { PublicFeedbackState } from "@/lib/types";

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function FeedbackBox({
  feedback,
  isAdmin,
  onSubmit,
}: {
  feedback: PublicFeedbackState;
  isAdmin: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 3000);
  }

  if (isAdmin) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="mb-4 text-sm font-medium text-neutral-500 dark:text-neutral-400">
          {feedback.submissionCount} submission{feedback.submissionCount === 1 ? "" : "s"} — fully anonymous
        </p>
        {feedback.items && feedback.items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {feedback.items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-100"
              >
                <p className="whitespace-pre-wrap">{item.text}</p>
                <p className="mt-2 text-xs text-neutral-400">{timeAgo(item.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">No feedback yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">
        Anonymous feedback for the room admin
      </p>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        Your name is never attached to what you send here.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share something the admin should know…"
          maxLength={2000}
          rows={4}
          className="resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <div className="flex items-center justify-between">
          {justSubmitted ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Sent anonymously ✓</span>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
