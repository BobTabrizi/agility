"use client";

import { useMemo } from "react";
import { getSocket } from "@/lib/socketClient";
import type { ActivityType } from "@/lib/types";

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
      setActivity: (activity: ActivityType) => socket.emit("activity:set", { activity }),
    };
  }, []);
}
