"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socketClient";
import type { JoinAck, PublicRoomState } from "@/lib/types";

interface UseRoomConnectionArgs {
  code: string;
  name: string;
  adminToken?: string;
  clientId: string;
}

export interface RoomConnection {
  state: PublicRoomState | null;
  error: string | null;
  status: "connecting" | "joined" | "error";
  self: { participantId: string; isAdmin: boolean } | null;
}

export function useRoomConnection({
  code,
  name,
  adminToken,
  clientId,
}: UseRoomConnectionArgs): RoomConnection {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "joined" | "error">("connecting");
  const [self, setSelf] = useState<{ participantId: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    if (!code || !name || !clientId) return;
    const socket = getSocket();
    let cancelled = false;

    function join() {
      setStatus("connecting");
      socket.emit("room:join", { code, name, adminToken, clientId }, (ack: JoinAck) => {
        if (cancelled) return;
        if (!ack.ok) {
          setError(ack.error || "Unable to join room");
          setStatus("error");
          return;
        }
        setError(null);
        setSelf({ participantId: ack.participantId!, isAdmin: !!ack.isAdmin });
        setStatus("joined");
      });
    }

    function onState(s: PublicRoomState) {
      if (!cancelled) setState(s);
    }
    function onRoomError(e: { message: string }) {
      if (!cancelled) setError(e.message);
    }

    socket.on("room:state", onState);
    socket.on("room:error", onRoomError);
    socket.on("connect", join);

    if (socket.connected) join();

    return () => {
      cancelled = true;
      socket.off("room:state", onState);
      socket.off("room:error", onRoomError);
      socket.off("connect", join);
      socket.emit("room:leave");
    };
  }, [code, name, adminToken, clientId]);

  return { state, error, status, self };
}
