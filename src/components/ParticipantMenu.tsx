"use client";

import { useEffect, useRef, useState } from "react";
import type { Participant } from "@/lib/types";

const itemBaseClass = "block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800";
const itemClass = `${itemBaseClass} text-neutral-700 dark:text-neutral-200`;
const dangerItemClass = `${itemBaseClass} text-red-600 dark:text-red-400`;

/**
 * Admin-only "⋮" menu on a roster row. Renders nothing if there's no action
 * that applies to this participant (e.g. the room creator, as seen by
 * anyone).
 */
export function ParticipantMenu({
  participant,
  isSelf,
  isAppointed,
  onAppointAdmin,
  onRevokeAdmin,
  onKick,
}: {
  participant: Participant;
  isSelf: boolean;
  // Made admin by another admin, as opposed to the room creator.
  isAppointed: boolean;
  onAppointAdmin: () => void;
  onRevokeAdmin: () => void;
  onKick: () => void;
}) {
  // Fixed-position coordinates, set while open. The roster list scrolls
  // (overflow-y-auto), which would clip an absolutely positioned dropdown, so
  // the menu is placed against the viewport instead — and closes on any
  // scroll rather than drifting away from its row.
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    function close() {
      setPosition(null);
    }
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  const isCreator = participant.isAdmin && !isAppointed;
  // Appointing hands the new token to the person's live connection, so it
  // needs them to be here (see admin:appoint in socketServer.ts).
  const canAppoint = !participant.isAdmin && participant.connected;
  const canKick = !isSelf && !isCreator;
  if (!canAppoint && !isAppointed && !canKick) return null;

  function choose(action: () => void) {
    setPosition(null);
    action();
  }

  return (
    <div ref={menuRef} className="shrink-0">
      <button
        type="button"
        onClick={(e) => {
          if (position) {
            setPosition(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
        }}
        aria-label={`Actions for ${participant.name}`}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      >
        <span aria-hidden className="text-base leading-none">
          ⋮
        </span>
      </button>

      {position && (
        <div
          role="menu"
          style={{ top: position.top, right: position.right }}
          className="fixed z-30 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          {canAppoint && (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onAppointAdmin)}
              title="They'll be able to run activities and read Feedback Box submissions"
              className={itemClass}
            >
              Make admin
            </button>
          )}
          {isAppointed && (
            <button type="button" role="menuitem" onClick={() => choose(onRevokeAdmin)} className={itemClass}>
              {isSelf ? "Step down as admin" : "Remove admin"}
            </button>
          )}
          {canKick && (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onKick)}
              className={dangerItemClass}
            >
              Kick from room…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
