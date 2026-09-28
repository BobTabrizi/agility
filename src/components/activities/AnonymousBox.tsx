"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DeleteAllButton, DeleteEntryButton } from "@/components/DeleteControls";
import {
  MAX_FEEDBACK_LENGTH,
  MAX_FEEDBACK_SUBMISSIONS,
  type DeleteTarget,
  type FeedbackItem,
  type FeedbackState,
  type FeedbackSubmitResponse,
} from "@/lib/types";

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Feedback text isn't part of the pushed room state (only the count is) —
 * the admin view fetches it when shown, and again whenever the submission
 * count changes. A reload keeps showing the previous list until the new one
 * arrives, rather than flashing back to "Loading…".
 */
function AdminFeedbackList({
  submissionCount,
  onFetch,
  onDelete,
}: {
  submissionCount: number;
  onFetch: () => Promise<FeedbackItem[]>;
  onDelete: (target: DeleteTarget) => void;
}) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onFetch().then(
      (fetched) => {
        if (cancelled) return;
        setItems(fetched);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [onFetch, submissionCount]);

  // Removed from view straight away; the reload the count change triggers confirms it.
  function deleteItems(target: DeleteTarget) {
    setItems((current) => current && ("all" in target ? [] : current.filter((item) => item.id !== target.id)));
    onDelete(target);
  }

  if (!items) {
    return (
      <p className="text-sm text-neutral-400">
        {failed ? "Couldn't load feedback. Switch activities and back to retry." : "Loading…"}
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-neutral-400">No feedback yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-100"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 whitespace-pre-wrap break-words">{item.text}</p>
            <DeleteEntryButton label="Delete this submission" onDelete={() => deleteItems({ id: item.id })} />
          </div>
          <p className="mt-2 text-xs text-neutral-400">{timeAgo(item.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

/** The submission form — for participants, and for admins above the list. */
function FeedbackForm({
  isAdmin,
  full,
  onSubmit,
}: {
  isAdmin: boolean;
  // At MAX_FEEDBACK_SUBMISSIONS: the server would refuse, so say so up front.
  full: boolean;
  onSubmit: (text: string) => Promise<FeedbackSubmitResponse>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Only clears the text and confirms once the server says it's stored; on a
  // failure the text stays put so nothing typed is lost.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    const res = await onSubmit(trimmed);
    setSending(false);
    if (!res.ok) {
      setSendError(res.error);
      return;
    }
    setText("");
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 3000);
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-50">
        {isAdmin ? "Add your own feedback" : "Anonymous feedback for the room admin"}
      </p>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        {isAdmin
          ? "It's anonymous too — other admins see it like any other submission."
          : "Your name is never attached to what you send here."}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isAdmin ? "Add something to the Anonymous Box…" : "Share something the admin should know…"}
          maxLength={MAX_FEEDBACK_LENGTH}
          rows={isAdmin ? 3 : 4}
          className="resize-none rounded-lg border border-neutral-300 px-3 py-2 text-base sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
        <div className="flex items-center justify-between gap-3">
          {full ? (
            <span className="text-sm text-amber-600 dark:text-amber-400">
              The Anonymous Box is full ({MAX_FEEDBACK_SUBMISSIONS} submissions)
              {isAdmin ? " — delete some below to make room." : " — an admin needs to clear some first."}
            </span>
          ) : sendError ? (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {sendError}
            </span>
          ) : justSubmitted ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Sent anonymously ✓</span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-3">
            {/* The box stops accepting input at the limit, so show how close you are. */}
            <span
              className={`text-xs tabular-nums ${
                text.length >= MAX_FEEDBACK_LENGTH ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"
              }`}
            >
              {text.length} / {MAX_FEEDBACK_LENGTH}
            </span>
            <button
              type="submit"
              disabled={!text.trim() || sending || full}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white enabled:hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function AnonymousBox({
  feedback,
  isAdmin,
  onSubmit,
  onFetchItems,
  onDelete,
}: {
  feedback: FeedbackState;
  isAdmin: boolean;
  onSubmit: (text: string) => Promise<FeedbackSubmitResponse>;
  onFetchItems: () => Promise<FeedbackItem[]>;
  onDelete: (target: DeleteTarget) => void;
}) {
  const full = feedback.submissionCount >= MAX_FEEDBACK_SUBMISSIONS;
  if (!isAdmin) return <FeedbackForm isAdmin={false} full={full} onSubmit={onSubmit} />;

  // Admins can add feedback too (the server treats every submission alike);
  // their own shows up in the list once the count bumps and it refetches.
  return (
    <div className="flex flex-col gap-6">
      <FeedbackForm isAdmin full={full} onSubmit={onSubmit} />
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
            {feedback.submissionCount} submission{feedback.submissionCount === 1 ? "" : "s"} — fully anonymous
          </p>
          {feedback.submissionCount > 0 && (
            <DeleteAllButton
              what={`${feedback.submissionCount} submission${feedback.submissionCount === 1 ? "" : "s"}`}
              onConfirm={() => onDelete({ all: true })}
            />
          )}
        </div>
        <AdminFeedbackList submissionCount={feedback.submissionCount} onFetch={onFetchItems} onDelete={onDelete} />
      </div>
    </div>
  );
}
