"use client";

import { useState, type FormEvent } from "react";
import { HistoryLink } from "@/components/HistoryLink";
import { PollHistoryModal } from "@/components/activities/PollHistoryModal";
import {
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION_LENGTH,
  MIN_POLL_OPTIONS,
  type PollHistoryEntry,
  type PollHistorySummary,
  type PublicPollState,
} from "@/lib/types";

type NewPoll = { question: string; options: string[]; multiple: boolean; anonymous: boolean };

const cardClass =
  "rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
const secondaryButtonClass =
  "rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800";
const primaryButtonClass =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40";

/**
 * A StrawPoll-style poll: an admin asks a question with options; everyone
 * votes (single or multiple choice), and sees the results once they have.
 * What results each person gets is decided server-side (PublicPollState).
 */
export function Poll({
  poll,
  isAdmin,
  historySummary,
  onCreate,
  onVote,
  onSetClosed,
  onFetchHistory,
}: {
  poll: PublicPollState;
  isAdmin: boolean;
  historySummary: PollHistorySummary;
  onCreate: (poll: NewPoll) => void;
  onVote: (pollId: string, optionIds: string[]) => void;
  onSetClosed: (closed: boolean) => void;
  onFetchHistory: () => Promise<PollHistoryEntry[]>;
}) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  function renderCard() {
    if (isAdmin && (poll.id === null || editing)) {
      return (
        <PollEditor
          replacing={poll.id !== null}
          onCancel={poll.id !== null ? () => setEditing(false) : undefined}
          onCreate={(newPoll) => {
            onCreate(newPoll);
            setEditing(false);
          }}
        />
      );
    }

    if (poll.id === null) {
      return (
        <div className={cardClass}>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No poll yet — the admin will start one.
          </p>
        </div>
      );
    }

    return (
      // Keyed by poll so a new poll starts with a fresh selection.
      <PollView
        key={poll.id}
        poll={poll}
        isAdmin={isAdmin}
        onVote={(optionIds) => onVote(poll.id!, optionIds)}
        onSetClosed={onSetClosed}
        onNewPoll={() => setEditing(true)}
      />
    );
  }

  // Under the card in every state, so past polls are always reachable.
  return (
    <div className="flex flex-col gap-3">
      {renderCard()}
      <HistoryLink
        label="View past polls"
        show={historySummary.count > 0}
        onOpen={() => setHistoryOpen(true)}
      />
      {historyOpen && (
        <PollHistoryModal
          latestRecordedAt={historySummary.latestRecordedAt}
          onFetch={onFetchHistory}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

/** Mounts fresh each time it's shown, so plain useState is enough (no draft-sync needed). */
function PollEditor({
  replacing,
  onCreate,
  onCancel,
}: {
  replacing: boolean;
  onCreate: (poll: NewPoll) => void;
  onCancel?: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(true);

  const filledOptions = options.map((o) => o.trim()).filter(Boolean);
  const distinctOptions = new Set(filledOptions).size;
  const canStart = question.trim().length > 0 && distinctOptions >= MIN_POLL_OPTIONS;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    onCreate({ question: question.trim(), options: filledOptions, multiple, anonymous });
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} flex flex-col gap-4`}>
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">New poll</h2>
      <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Question
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Where should we go for the team lunch?"
          maxLength={MAX_POLL_QUESTION_LENGTH}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">Options</legend>
        {options.map((option, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`Option ${i + 1}`}
              value={option}
              onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
              placeholder={`Option ${i + 1}`}
              maxLength={MAX_POLL_OPTION_LENGTH}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
            />
            {options.length > MIN_POLL_OPTIONS && (
              <button
                type="button"
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                aria-label={`Remove option ${i + 1}`}
                className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_POLL_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions([...options, ""])}
            className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            + Add option
          </button>
        )}
      </fieldset>

      <div className="flex flex-col gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
          Allow picking more than one option
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          Anonymous — show only counts, not who voted for what
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          {replacing ? "Starting a new poll ends the current one — its results are saved to poll history." : ""}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={!canStart} className={primaryButtonClass}>
            Start poll
          </button>
        </div>
      </div>
    </form>
  );
}

function sameChoices(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function PollView({
  poll,
  isAdmin,
  onVote,
  onSetClosed,
  onNewPoll,
}: {
  poll: PublicPollState;
  isAdmin: boolean;
  onVote: (optionIds: string[]) => void;
  onSetClosed: (closed: boolean) => void;
  onNewPoll: () => void;
}) {
  // Draft-sync idiom (see CLAUDE.md): the selection follows your saved vote
  // when that changes underneath (e.g. voted from another tab), but is
  // otherwise yours to edit before pressing Vote.
  const myVoteKey = poll.myVote.join(",");
  const [selection, setSelection] = useState<string[]>(poll.myVote);
  const [lastSeenVoteKey, setLastSeenVoteKey] = useState(myVoteKey);
  if (myVoteKey !== lastSeenVoteKey) {
    setLastSeenVoteKey(myVoteKey);
    setSelection(poll.myVote);
  }

  const hasVoted = poll.myVote.length > 0;
  const selectionChanged = !sameChoices(selection, poll.myVote);
  const resultsById = new Map((poll.results ?? []).map((r) => [r.optionId, r]));

  function toggle(optionId: string) {
    if (poll.closed) return;
    if (!poll.multiple) {
      setSelection([optionId]);
      return;
    }
    setSelection(
      selection.includes(optionId) ? selection.filter((id) => id !== optionId) : [...selection, optionId]
    );
  }

  return (
    <div className={`${cardClass} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{poll.question}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            poll.multiple ? "Multiple choice" : "Single choice",
            poll.anonymous ? "Anonymous" : "Named",
            ...(poll.closed ? ["Closed"] : []),
          ].map((tag) => (
            <span
              key={tag}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tag === "Closed"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-2" role={poll.multiple ? "group" : "radiogroup"} aria-label={poll.question}>
        {poll.options.map((option) => {
          const selected = selection.includes(option.id);
          const result = resultsById.get(option.id);
          const percent = result && poll.voterCount > 0 ? Math.round((result.count / poll.voterCount) * 100) : 0;
          return (
            <li key={option.id}>
              <button
                type="button"
                role={poll.multiple ? "checkbox" : "radio"}
                aria-checked={selected}
                disabled={poll.closed}
                onClick={() => toggle(option.id)}
                className={`relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${
                  selected
                    ? "border-indigo-500 ring-1 ring-indigo-500"
                    : "border-neutral-200 enabled:hover:border-neutral-300 dark:border-neutral-800 dark:enabled:hover:border-neutral-700"
                }`}
              >
                {/* Result bar, behind the text. */}
                {result && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-indigo-100 transition-[width] duration-500 dark:bg-indigo-950/70"
                    style={{ width: `${percent}%` }}
                  />
                )}
                <span className="relative flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                      poll.multiple ? "rounded" : "rounded-full"
                    } ${selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-neutral-400"}`}
                  >
                    {selected && <span className="text-[10px] leading-none">✓</span>}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-neutral-800 dark:text-neutral-100">
                    {option.text}
                  </span>
                  {result && (
                    <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {result.count} · {percent}%
                    </span>
                  )}
                </span>
                {result?.voters && result.voters.length > 0 && (
                  <span className="relative mt-1 block pl-7 text-xs text-neutral-500 dark:text-neutral-400">
                    {result.voters.join(", ")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {poll.voterCount} {poll.voterCount === 1 ? "person has" : "people have"} voted
          {!poll.results && " · results appear after you vote"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <button type="button" onClick={onNewPoll} className={secondaryButtonClass}>
                New poll
              </button>
              <button type="button" onClick={() => onSetClosed(!poll.closed)} className={secondaryButtonClass}>
                {poll.closed ? "Reopen poll" : "Close poll"}
              </button>
            </>
          )}
          {!poll.closed &&
            (hasVoted && !selectionChanged ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">Voted ✓</span>
            ) : (
              <button
                type="button"
                disabled={selection.length === 0 || !selectionChanged}
                onClick={() => onVote(selection)}
                className={primaryButtonClass}
              >
                {hasVoted ? "Change vote" : "Vote"}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
