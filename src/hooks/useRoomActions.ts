"use client";

import { useMemo } from "react";
import { getSocket } from "@/lib/socketClient";
import type {
  ActivityType,
  PlinkoSpeed,
  FeedbackItem,
  FeedbackItemsResponse,
  PokerHistoryEntry,
  PokerHistoryResponse,
  PollHistoryEntry,
  PollHistoryResponse,
} from "@/lib/types";

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
      setWheelOptions: (options: string[]) => socket.emit("wheel:setOptions", { options }),
      spinWheel: () => socket.emit("wheel:spin"),
      removeWheelWinner: (spinId: string) => socket.emit("wheel:removeWinner", { spinId }),
      setPlinkoOptions: (options: string[]) => socket.emit("plinko:setOptions", { options }),
      dropPlinko: () => socket.emit("plinko:drop"),
      setPlinkoSpeed: (speed: PlinkoSpeed) => socket.emit("plinko:setSpeed", { speed }),
      removePlinkoWinner: (dropId: string) => socket.emit("plinko:removeWinner", { dropId }),
      generateTeams: (names: string[], count: number) =>
        socket.emit("teams:generate", { names, count }),
      setActivity: (activity: ActivityType) => socket.emit("activity:set", { activity }),
      appointAdmin: (participantId: string) => socket.emit("admin:appoint", { participantId }),
      revokeAdmin: (participantId: string) => socket.emit("admin:revoke", { participantId }),
      kick: (participantId: string) => socket.emit("participant:kick", { participantId }),
      createPoll: (poll: { question: string; options: string[]; multiple: boolean; anonymous: boolean }) =>
        socket.emit("poll:create", poll),
      votePoll: (pollId: string, optionIds: string[]) => socket.emit("poll:vote", { pollId, optionIds }),
      setPollClosed: (closed: boolean) => socket.emit("poll:setClosed", { closed }),
      fetchPollHistory: async (): Promise<PollHistoryEntry[]> => {
        const res: PollHistoryResponse = await socket.timeout(10_000).emitWithAck("poll:getHistory");
        if (!res.ok) throw new Error(res.error);
        return res.entries;
      },
      // A request/response rather than fire-and-forget: history isn't part of
      // the pushed room state, so the history dialog asks for it when opened.
      fetchPokerHistory: async (): Promise<PokerHistoryEntry[]> => {
        const res: PokerHistoryResponse = await socket.timeout(10_000).emitWithAck("poker:getHistory");
        if (!res.ok) throw new Error(res.error);
        return res.entries;
      },
      // Same idea for the admin's Feedback Box: submissions are fetched, not pushed.
      fetchFeedbackItems: async (): Promise<FeedbackItem[]> => {
        const res: FeedbackItemsResponse = await socket.timeout(10_000).emitWithAck("feedback:getItems");
        if (!res.ok) throw new Error(res.error);
        return res.items;
      },
    };
  }, []);
}
