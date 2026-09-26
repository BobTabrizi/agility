"use client";

import { useEffect, useRef, useState } from "react";
import { InviteModal } from "@/components/InviteModal";
import { Modal } from "@/components/Modal";
import { ParticipantMenu } from "@/components/ParticipantMenu";
import { MAX_DISPLAY_NAME_LENGTH, truncateName } from "@/lib/participants";
import type { Participant } from "@/lib/types";

export function RoomHeader({
  name,
  code,
  participants,
  appointedAdminIds,
  selfId,
  isAdmin,
  onAppointAdmin,
  onRevokeAdmin,
  onKick,
}: {
  name: string;
  code: string;
  participants: Participant[];
  appointedAdminIds: string[];
  selfId: string;
  isAdmin: boolean;
  onAppointAdmin: (participantId: string) => void;
  onRevokeAdmin: (participantId: string) => void;
  onKick: (participantId: string) => void;
}) {
  const [rosterOpen, setRosterOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [kickTarget, setKickTarget] = useState<Participant | null>(null);
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

  return (
    <div className="flex flex-col gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{name}</h1>
          {isAdmin && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              Admin
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          Room code <span className="font-mono font-semibold tracking-wide">{code}</span> ·{" "}
          {connectedParticipants.length === participants.length
            ? `${connectedParticipants.length} here`
            : `${connectedParticipants.length} of ${participants.length} here`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div ref={rosterRef} className="relative">
          <button
            type="button"
            onClick={() => setRosterOpen((v) => !v)}
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
                {participants.length} joined this room
              </p>
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {participants.map((p) => (
                  <li
                    key={p.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      p.connected ? "" : "opacity-50"
                    }`}
                  >
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${
                        p.connected ? "bg-indigo-500" : "bg-neutral-400 dark:bg-neutral-600"
                      }`}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    {/* Cut at a fixed length, with `truncate` as a fallback when
                        even that doesn't fit beside the row's labels. Whether to
                        show the full-name tooltip is decided on hover, since only
                        the rendered width says whether CSS clipped it too. */}
                    <span
                      className="min-w-0 truncate text-neutral-800 dark:text-neutral-100"
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        const shortened =
                          p.name.length > MAX_DISPLAY_NAME_LENGTH || el.scrollWidth > el.clientWidth;
                        el.title = shortened ? p.name : "";
                      }}
                    >
                      {truncateName(p.name)}
                    </span>
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
                    <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
                      {!p.connected && <span className="text-xs text-neutral-400">Away</span>}
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
        <button
          onClick={() => setInviteOpen(true)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Copy invite link
        </button>
      </div>

      {inviteOpen && <InviteModal url={inviteUrl()} onClose={() => setInviteOpen(false)} />}

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
