"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { JoinNameForm } from "@/components/JoinNameForm";
import { RoomShell } from "@/components/RoomShell";
import { useRoomConnection } from "@/hooks/useRoomConnection";
import { getOrCreateClientId, getSessionDisplayName, setSessionDisplayName } from "@/lib/storage";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code || "").toUpperCase();

  const [name, setName] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");

  // localStorage/sessionStorage aren't available during SSR, so this has to run
  // as a post-hydration effect rather than during render to avoid a mismatch.
  useEffect(() => {
    if (!code) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(getSessionDisplayName(code) ?? null);
    setClientId(getOrCreateClientId(code));
  }, [code]);

  const { state, error, notice, dismissNotice, status, self } = useRoomConnection({
    code,
    name: name ?? "",
    clientId,
  });

  if (!code) return null;

  if (name === null) {
    return (
      <JoinNameForm
        code={code}
        onJoin={(joinedName) => {
          setSessionDisplayName(code, joinedName);
          setName(joinedName);
        }}
      />
    );
  }

  if (status === "kicked") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            You were removed from room {code}
          </p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            An admin kicked you from the room. You can rejoin if you need to.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Rejoin
            </button>
            <Link
              href="/"
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Couldn&apos;t join room {code}
          </p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Back home
          </Link>
        </div>
      </div>
    );
  }

  if (status !== "joined" || !state || !self) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Connecting…</p>
      </div>
    );
  }

  return (
    <>
      <RoomShell state={state} selfId={self.participantId} isAdmin={state.viewerIsAdmin} />
      {notice && <ErrorNotice key={notice.id} message={notice.message} onDismiss={dismissNotice} />}
    </>
  );
}
