"use client";

import { ACTIVITIES, type ActivityType } from "@/lib/types";

export function ActivityTabs({
  active,
  isAdmin,
  onChange,
}: {
  active: ActivityType;
  isAdmin: boolean;
  onChange: (activity: ActivityType) => void;
}) {
  if (!isAdmin) {
    const current = ACTIVITIES.find((a) => a.id === active);
    return (
      <div className="inline-flex w-fit rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
        {current?.label}
      </div>
    );
  }

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
