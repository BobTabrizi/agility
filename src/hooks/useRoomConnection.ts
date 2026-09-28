"use client";

import { useCallback, useEffect, useState } from "react";
import { getSocket } from "@/lib/socketClient";
import { getStoredAdminToken, setStoredAdminToken } from "@/lib/storage";
import { createTabClaim } from "@/lib/tabClaim";
import type { JoinAck, PublicRoomState } from "@/lib/types";

// How long to wait for the server to answer a join before showing an error
// (a reply it never sends would otherwise leave "Connecting…" up forever).
const JOIN_TIMEOUT_MS = 10_000;

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
  // "elsewhere": another tab in this browser opened a room and took over
  // (only one tab per browser stays connected — see tabClaim.ts).
  status: "connecting" | "joined" | "error" | "kicked" | "elsewhere";
  // For an "elsewhere" tab: take the connection back from the other tab.
  takeOver: () => void;
  // Whether the room shown is live: false from a dropped connection (e.g. a
  // server restart) until the automatic reconnect has rejoined. The room
  // stays on screen meanwhile, but shouldn't be interacted with — anything
  // sent before the rejoin would be ignored by the server.
  connected: boolean;
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
  const [connected, setConnected] = useState(false);
  // Bumped by takeOver, re-running the effect below: a fresh claim and connect.
  const [claimAttempt, setClaimAttempt] = useState(0);
  const takeOver = useCallback(() => {
    setStatus("connecting");
    setClaimAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!code || !name || !clientId) return;
    const socket = getSocket();
    let cancelled = false;
    let takenOver = false;
    const tab = createTabClaim(() => {
      if (cancelled) return;
      takenOver = true;
      setStatus("elsewhere");
      socket.disconnect();
    });
    // Only the latest join's reply counts: a reconnect starts a new join, and
    // the old one's timeout mustn't overwrite the new one's success.
    let latestJoin = 0;

    function join() {
      const thisJoin = ++latestJoin;
      // A rejoin after a dropped connection keeps showing the room (behind
      // the "reconnecting" banner) rather than going back to "Connecting…".
      setStatus((s) => (s === "joined" ? s : "connecting"));
      // Read fresh on every (re)join rather than captured once, so a token
      // granted mid-session (admin:granted) is still presented after a reconnect.
      const adminToken = getStoredAdminToken(code);
      socket.timeout(JOIN_TIMEOUT_MS).emit("room:join", { code, name, adminToken, clientId }, (err: Error | null, ack: JoinAck) => {
        if (cancelled || thisJoin !== latestJoin) return;
        if (err) {
          // No reply in time. If the connection comes back, the "connect"
          // handler joins again, so this can still recover on its own.
          setError("The server didn't respond. Check your connection and try again.");
          setStatus("error");
          return;
        }
        if (!ack.ok) {
          setError(ack.error || "Unable to join room");
          setStatus("error");
          return;
        }
        setError(null);
        setSelf({ participantId: ack.participantId! });
        setStatus("joined");
        setConnected(true);
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
    // The server refused the connection itself (e.g. too many from this
    // network). `active` is false then: unlike an unreachable server, the
    // client won't keep retrying, so show why instead of "Connecting…" forever.
    function onConnectError(err: Error) {
      if (cancelled || socket.active) return;
      setError(err.message);
      setStatus("error");
    }
    function onDisconnect() {
      if (!cancelled) setConnected(false);
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
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);

    // Only once any other tab of this browser has let go (see tabClaim.ts).
    // The shared socket can be sitting disconnected (this tab was kicked, or
    // was taken over and is now taking back), so reconnect it rather than
    // waiting for a "connect" that would never come.
    tab.claim().then(() => {
      if (cancelled || takenOver) return;
      if (socket.connected) join();
      else socket.connect();
    });

    return () => {
      cancelled = true;
      tab.close();
      socket.off("room:state", onState);
      socket.off("room:error", onRoomError);
      socket.off("admin:granted", onAdminGranted);
      socket.off("room:kicked", onKicked);
      socket.off("connect", join);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
      // A disconnected socket would buffer this and send it on reconnecting.
      if (socket.connected) socket.emit("room:leave");
    };
  }, [code, name, clientId, claimAttempt]);

  return { state, error, notice, dismissNotice, status, self, takeOver, connected };
}
