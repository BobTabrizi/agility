"use client";

import { ACTIVITIES, type ActivityType } from "@/lib/types";

/** Admin-only activity switcher; participants see the current activity in the room header. */
export function ActivityTabs({
  active,
  onChange,
}: {
  active: ActivityType;
  onChange: (activity: ActivityType) => void;
}) {
  return (
    <div className="inline-flex w-fit gap-1 rounded-full border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
      {ACTIVITIES.map((a) => (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
            active === a.id
              ? "bg-indigo-600 text-white"
              : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
