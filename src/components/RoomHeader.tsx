"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActivityMenu } from "@/components/ActivityMenu";
import { InviteModal } from "@/components/InviteModal";
import { Modal } from "@/components/Modal";
import { ParticipantMenu } from "@/components/ParticipantMenu";
import { Toast } from "@/components/Toast";
import { copyText } from "@/lib/clipboard";
import { MAX_DISPLAY_NAME_LENGTH, truncateName } from "@/lib/participants";
import type { ActivityType, LeaveResponse, Participant } from "@/lib/types";

export function RoomHeader({
  name,
  code,
  participants,
  activeActivity,
  appointedAdminIds,
  selfId,
  isAdmin,
  onAppointAdmin,
  onRevokeAdmin,
  onKick,
  onLeave,
  onChangeActivity,
}: {
  name: string;
  code: string;
  participants: Participant[];
  activeActivity: ActivityType;
  appointedAdminIds: string[];
  selfId: string;
  isAdmin: boolean;
  onAppointAdmin: (participantId: string) => void;
  onRevokeAdmin: (participantId: string) => void;
  onKick: (participantId: string) => void;
  onLeave: () => Promise<LeaveResponse>;
  onChangeActivity: (activity: ActivityType) => void;
}) {
  const [rosterOpen, setRosterOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // When the link icon last copied the invite link (shows the "copied" pop-up;
  // a new timestamp re-shows it on a repeat click).
  const [linkCopiedAt, setLinkCopiedAt] = useState<number | null>(null);
  const hideCopiedToast = useCallback(() => setLinkCopiedAt(null), []);
  const [kickTarget, setKickTarget] = useState<Participant | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const router = useRouter();

  async function leave() {
    setLeaving(true);
    setLeaveError(null);
    const res = await onLeave();
    if (res.ok) {
      router.push("/");
      return;
    }
    setLeaving(false);
    setLeaveError(res.error);
  }
  const selfIsAppointedAdmin = appointedAdminIds.includes(selfId);
  const selfIsCreator = participants.some((p) => p.id === selfId && p.isAdmin) && !selfIsAppointedAdmin;
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rosterOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rosterRef.current?.contains(e.target as Node)) {
        setRosterOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setRosterOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [rosterOpen]);

  function inviteUrl() {
    return `${window.location.origin}/room/${code}`;
  }

  const connectedParticipants = participants.filter((p) => p.connected);
  const hereCount = `${connectedParticipants.length} / ${participants.length}`;
  // You first, then everyone else in join order.
  const rosterOrder = [
    ...participants.filter((p) => p.id === selfId),
    ...participants.filter((p) => p.id !== selfId),
  ];

  return (
    <div className="flex flex-col gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {/* name | current activity. The name truncates (full name on hover)
            rather than wrapping, so the divider never ends up dangling at the
            end of a line. */}
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="min-w-0 truncate text-xl font-semibold text-neutral-900 dark:text-neutral-50" title={name}>
            {name}
          </h1>
          <span aria-hidden className="h-5 w-px shrink-0 bg-neutral-300 dark:bg-neutral-700" />
          <ActivityMenu active={activeActivity} isAdmin={isAdmin} onChange={onChangeActivity} />
        </div>
        <p className="mt-0.5 flex items-center text-sm text-neutral-500 dark:text-neutral-400">
          <span className="sr-only">Room code </span>
          <span className="font-mono font-semibold tracking-wide" title="Room code">
            {code}
          </span>
          <button
            type="button"
            onClick={() => {
              // Copy straight away (it has to happen within the click) and
              // open the invite dialog for the QR code.
              setInviteOpen(true);
              void copyText(inviteUrl()).then((ok) => ok && setLinkCopiedAt(Date.now()));
            }}
            aria-label="Copy invite link"
            title="Copy invite link"
            className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-indigo-600 dark:hover:bg-neutral-800 dark:hover:text-indigo-400"
          >
            <LinkIcon />
          </button>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div ref={rosterRef} className="relative">
          <button
            type="button"
            onClick={() => setRosterOpen((v) => !v)}
            aria-label={`Members, ${connectedParticipants.length} of ${participants.length} here`}
            aria-haspopup="true"
            aria-expanded={rosterOpen}
            className="flex -space-x-2 rounded-full transition hover:opacity-80"
          >
            {connectedParticipants.slice(0, 6).map((p) => (
              <div
                key={p.id}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-indigo-500 text-xs font-semibold text-white dark:border-neutral-900"
              >
                {p.name.slice(0, 2).toUpperCase()}
              </div>
            ))}
            {connectedParticipants.length > 6 && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-neutral-400 text-xs font-semibold text-white dark:border-neutral-900">
                +{connectedParticipants.length - 6}
              </div>
            )}
          </button>

          {/* Opens rightward on phones, where the header stacks and the
              avatars sit at the left edge; leftward from sm up, where they're
              on the right. */}
          {rosterOpen && (
            <div
              className="absolute left-0 top-full z-10 mt-2 w-96 max-w-[calc(100vw-3rem)] rounded-xl border border-neutral-200 bg-white p-2 shadow-lg sm:left-auto sm:right-0 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {hereCount} members here
              </p>
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {rosterOrder.map((p) => (
                  <li
                    key={p.id}
                    // The gray avatar and dimmed row are the visual cue; this
                    // spells it out on hover (the name's own tooltip wins over it).
                    // The dimming goes on the row's contents, not the row: opacity
                    // applies to everything inside, including the ⋮ menu's dropdown.
                    title={p.connected ? undefined : "Away — not connected right now"}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      p.id === selfId ? "bg-indigo-50 dark:bg-indigo-950/50" : ""
                    }`}
                  >
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${
                        p.connected ? "bg-indigo-500" : "bg-neutral-400 opacity-50 dark:bg-neutral-600"
                      }`}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    {/* Cut at a fixed length, with `truncate` as a fallback when
                        even that doesn't fit beside the row's labels. Whether to
                        show the full-name tooltip is decided on hover, since only
                        the rendered width says whether CSS clipped it too. */}
                    <span
                      className={`min-w-0 truncate text-neutral-800 dark:text-neutral-100 ${p.connected ? "" : "opacity-50"}`}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        const shortened =
                          p.name.length > MAX_DISPLAY_NAME_LENGTH || el.scrollWidth > el.clientWidth;
                        el.title = shortened ? p.name : "";
                      }}
                    >
                      {truncateName(p.name)}
                    </span>
                    {/* The row highlight marks you visually; this says it to screen readers. */}
                    {p.id === selfId && <span className="sr-only">(you)</span>}
                    {p.id === selfId && (
                      <button
                        type="button"
                        onClick={() => {
                          setRosterOpen(false);
                          setLeaveError(null);
                          setConfirmingLeave(true);
                        }}
                        aria-label="Leave room"
                        title="Leave room"
                        // Same footprint as the "⋮" on other rows, so the list lines up.
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <DoorIcon />
                      </button>
                    )}
                    {!p.connected && <span className="sr-only">(away)</span>}
                    {isAdmin && (
                      <ParticipantMenu
                        participant={p}
                        isSelf={p.id === selfId}
                        isAppointed={appointedAdminIds.includes(p.id)}
                        onAppointAdmin={() => onAppointAdmin(p.id)}
                        onRevokeAdmin={() => onRevokeAdmin(p.id)}
                        onKick={() => setKickTarget(p)}
                      />
                    )}
                    <div className={`ml-auto flex shrink-0 items-center gap-1.5 pl-1 ${p.connected ? "" : "opacity-50"}`}>
                      {p.isAdmin && (
                        <span
                          className="text-xs font-medium text-indigo-600 dark:text-indigo-400"
                          title={appointedAdminIds.includes(p.id) ? undefined : "Created this room"}
                        >
                          Admin
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {inviteOpen && (
        <InviteModal
          url={inviteUrl()}
          copied={linkCopiedAt !== null}
          onClose={() => {
            setInviteOpen(false);
            setLinkCopiedAt(null);
          }}
        />
      )}
      {linkCopiedAt !== null && <Toast key={linkCopiedAt} message="Invite link copied to clipboard" onDone={hideCopiedToast} />}

      {confirmingLeave && (
        <Modal title="Leave this room?" onClose={() => !leaving && setConfirmingLeave(false)}>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            You&apos;ll be removed from the member list.
            {selfIsAppointedAdmin && " You'll also stop being an admin."}
            {selfIsCreator && " As the room's creator, you'll still be an admin if you come back from this browser."}{" "}
            You can rejoin any time with the invite link.
          </p>
          {leaveError && (
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
              {leaveError}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingLeave(false)}
              disabled={leaving}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:enabled:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={leave}
              disabled={leaving}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white enabled:hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {leaving ? "Leaving…" : "Leave room"}
            </button>
          </div>
        </Modal>
      )}

      {kickTarget && (
        <Modal title={`Kick ${kickTarget.name}?`} onClose={() => setKickTarget(null)}>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {kickTarget.connected
              ? `${kickTarget.name} will be disconnected and removed from the room.`
              : `${kickTarget.name} will be removed from the room's roster.`}
            {appointedAdminIds.includes(kickTarget.id) && " They'll also lose admin."} They can rejoin
            with the invite link.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setKickTarget(null)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onKick(kickTarget.id);
                setKickTarget(null);
              }}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500"
            >
              Kick
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Lucide's "door-open" icon (ISC license), inlined like LinkIcon below.
function DoorIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 20H2" />
      <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z" />
      <path d="M11 4H8a2 2 0 0 0-2 2v14" />
      <path d="M14 12h.01" />
      <path d="M22 20h-3" />
    </svg>
  );
}

// Lucide's "link" icon (ISC license), inlined — the app has no icon library.
function LinkIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
