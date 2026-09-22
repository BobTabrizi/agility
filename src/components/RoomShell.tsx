"use client";

import { RoomHeader } from "@/components/RoomHeader";
import { ActivityTabs } from "@/components/ActivityTabs";
import { PlanningPoker } from "@/components/activities/PlanningPoker";
import { FeedbackBox } from "@/components/activities/FeedbackBox";
import { Plinko } from "@/components/activities/Plinko";
import { useRoomActions } from "@/hooks/useRoomActions";
import type { PublicRoomState } from "@/lib/types";

export function RoomShell({
  state,
  selfId,
  isAdmin,
}: {
  state: PublicRoomState;
  selfId: string;
  isAdmin: boolean;
}) {
  const actions = useRoomActions();
  const connectedParticipants = state.participants.filter((p) => p.connected);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <RoomHeader
          name={state.name}
          code={state.code}
          participants={state.participants}
          isAdmin={isAdmin}
        />

        <ActivityTabs active={state.activeActivity} isAdmin={isAdmin} onChange={actions.setActivity} />

        {state.activeActivity === "poker" && (
          <PlanningPoker
            poker={state.poker}
            participants={connectedParticipants}
            selfId={selfId}
            isAdmin={isAdmin}
            onVote={actions.vote}
            onReveal={actions.reveal}
            onReset={actions.reset}
            onSetTopic={actions.setTopic}
            onSetDeck={actions.setDeck}
            onSetAnonymous={actions.setAnonymous}
          />
        )}

        {state.activeActivity === "feedback" && (
          <FeedbackBox feedback={state.feedback} isAdmin={isAdmin} onSubmit={actions.submitFeedback} />
        )}

        {state.activeActivity === "plinko" && (
          <Plinko
            plinko={state.plinko}
            isAdmin={isAdmin}
            onSetOptions={actions.setPlinkoOptions}
            onSpin={actions.spin}
          />
        )}
      </div>
    </div>
  );
}
