"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIVITIES, type ActivityType } from "@/lib/types";

// Matches the menu's w-56, and the gap it keeps from the viewport's edge.
const MENU_WIDTH = 224;
const VIEWPORT_MARGIN = 8;

/**
 * The current activity, shown next to the room name, doubling as the
 * activity switcher. Everyone can open it to see what the options are, but
 * only admins can pick one — for participants every option is disabled, with
 * a note saying why.
 */
export function ActivityMenu({
  active,
  isAdmin,
  onChange,
}: {
  active: ActivityType;
  isAdmin: boolean;
  onChange: (activity: ActivityType) => void;
}) {
  const [open, setOpen] = useState(false);
  // Opens left-aligned under the trigger, unless that would run off the right
  // edge of the screen (a phone with a long room name) — then right-aligned.
  const [alignRight, setAlignRight] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeLabel = ACTIVITIES.find((a) => a.id === active)?.label;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAlignRight(rect.left + MENU_WIDTH > window.innerWidth - VIEWPORT_MARGIN);
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="-mx-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <span className="sr-only">Current activity: </span>
        {activeLabel}
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-neutral-400">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Activities"
          className={`absolute ${alignRight ? "right-0" : "left-0"} top-full z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900`}
        >
          {ACTIVITIES.map((activity) => {
            const isActive = activity.id === active;
            return (
              <button
                key={activity.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                disabled={!isAdmin}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onChange(activity.id);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm enabled:hover:bg-neutral-50 disabled:cursor-not-allowed dark:enabled:hover:bg-neutral-800 ${
                  isActive
                    ? "font-semibold text-indigo-600 dark:text-indigo-400"
                    : "text-neutral-700 disabled:text-neutral-400 dark:text-neutral-200 dark:disabled:text-neutral-500"
                }`}
              >
                {activity.label}
                {isActive && <span aria-hidden>✓</span>}
              </button>
            );
          })}
          {!isAdmin && (
            <p className="border-t border-neutral-200 px-3 pb-1.5 pt-2 text-xs text-neutral-400 dark:border-neutral-800">
              Only admins can switch activities.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
