"use client";

import { useCallback, useEffect, useState } from "react";
import { getSocket } from "@/lib/socketClient";
import { getStoredAdminToken, setStoredAdminToken } from "@/lib/storage";
import type { JoinAck, PublicRoomState } from "@/lib/types";

interface UseRoomConnectionArgs {
  code: string;
  name: string;
  clientId: string;
}

export interface RoomConnection {
  state: PublicRoomState | null;
  // Why joining failed — fatal, the room can't be shown.
  error: string | null;
  // A single action the server rejected (room:error, e.g. "The deck needs at
  // least one card") — the room is still fine, so this is shown as a
  // dismissible notice rather than replacing the room. `id` changes on every
  // error, even a repeat of the same message, so the notice can restart.
  notice: { id: number; message: string } | null;
  dismissNotice: () => void;
  // "kicked": an admin removed this person; the server has disconnected the
  // socket and it won't auto-reconnect. They can rejoin by reloading.
  status: "connecting" | "joined" | "error" | "kicked";
  // Admin status isn't here: it can change mid-session (appointed/removed by
  // another admin), so it's read from state.viewerIsAdmin on every broadcast.
  self: { participantId: string } | null;
}

export function useRoomConnection({
  code,
  name,
  clientId,
}: UseRoomConnectionArgs): RoomConnection {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [status, setStatus] = useState<RoomConnection["status"]>("connecting");
  const [self, setSelf] = useState<{ participantId: string } | null>(null);

  useEffect(() => {
    if (!code || !name || !clientId) return;
    const socket = getSocket();
    let cancelled = false;

    function join() {
      setStatus("connecting");
      // Read fresh on every (re)join rather than captured once, so a token
      // granted mid-session (admin:granted) is still presented after a reconnect.
      const adminToken = getStoredAdminToken(code);
      socket.emit("room:join", { code, name, adminToken, clientId }, (ack: JoinAck) => {
        if (cancelled) return;
        if (!ack.ok) {
          setError(ack.error || "Unable to join room");
          setStatus("error");
          return;
        }
        setError(null);
        setSelf({ participantId: ack.participantId! });
        setStatus("joined");
      });
    }

    function onState(s: PublicRoomState) {
      if (cancelled) return;
      // Keep the newest snapshot: broadcasts from concurrent writes can arrive
      // out of order. Equal versions still apply — e.g. room:auth re-sends the
      // same version with admin-only data now included.
      setState((prev) => (prev && prev.code === s.code && prev.version > s.version ? prev : s));
    }
    function onRoomError(e: { message: string }) {
      if (!cancelled) setNotice({ id: Date.now(), message: e.message });
    }
    function onKicked(k: { code: string }) {
      if (!cancelled && k.code === code) setStatus("kicked");
    }
    function onAdminGranted(g: { code: string; token: string }) {
      if (cancelled || g.code !== code) return;
      setStoredAdminToken(code, g.token);
      socket.emit("room:auth", { token: g.token });
    }

    socket.on("room:state", onState);
    socket.on("room:error", onRoomError);
    socket.on("admin:granted", onAdminGranted);
    socket.on("room:kicked", onKicked);
    socket.on("connect", join);

    // The shared socket can be sitting disconnected if this tab was kicked
    // from a room earlier (server-side disconnects don't auto-reconnect), so
    // reconnect it rather than waiting for a "connect" that would never come.
    if (socket.connected) join();
    else socket.connect();

    return () => {
      cancelled = true;
      socket.off("room:state", onState);
      socket.off("room:error", onRoomError);
      socket.off("admin:granted", onAdminGranted);
      socket.off("room:kicked", onKicked);
      socket.off("connect", join);
      socket.emit("room:leave");
    };
  }, [code, name, clientId]);

  return { state, error, notice, dismissNotice, status, self };
}
