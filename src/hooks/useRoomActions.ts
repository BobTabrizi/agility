"use client";

import { useMemo } from "react";
import { getSocket } from "@/lib/socketClient";
import type { ActivityType, PokerHistoryEntry, PokerHistoryResponse } from "@/lib/types";

export function useRoomActions() {
  return useMemo(() => {
    const socket = getSocket();
    return {
      vote: (value: string | null) => socket.emit("poker:vote", { value }),
      reveal: () => socket.emit("poker:reveal"),
      reset: () => socket.emit("poker:reset"),
      setTopic: (topic: string) => socket.emit("poker:setTopic", { topic }),
      setDeck: (deck: string[]) => socket.emit("poker:setDeck", { deck }),
      setAnonymous: (anonymous: boolean) => socket.emit("poker:setAnonymous", { anonymous }),
      submitFeedback: (text: string) => socket.emit("feedback:submit", { text }),
      setPlinkoOptions: (options: string[]) => socket.emit("plinko:setOptions", { options }),
      spin: () => socket.emit("plinko:spin"),
      generateTeams: (names: string[], count: number) =>
        socket.emit("teams:generate", { names, count }),
      setActivity: (activity: ActivityType) => socket.emit("activity:set", { activity }),
      appointAdmin: (participantId: string) => socket.emit("admin:appoint", { participantId }),
      revokeAdmin: (participantId: string) => socket.emit("admin:revoke", { participantId }),
      kick: (participantId: string) => socket.emit("participant:kick", { participantId }),
      // A request/response rather than fire-and-forget: history isn't part of
      // the pushed room state, so the history dialog asks for it when opened.
      fetchPokerHistory: async (): Promise<PokerHistoryEntry[]> => {
        const res: PokerHistoryResponse = await socket.timeout(10_000).emitWithAck("poker:getHistory");
        if (!res.ok) throw new Error(res.error);
        return res.entries;
      },
    };
  }, []);
}
