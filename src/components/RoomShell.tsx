"use client";

import { RoomHeader } from "@/components/RoomHeader";
import { PlanningPoker } from "@/components/activities/PlanningPoker";
import { PokerOptionsMenu } from "@/components/activities/PokerOptionsMenu";
import { FeedbackBox } from "@/components/activities/FeedbackBox";
import { Plinko } from "@/components/activities/Plinko";
import { Poll } from "@/components/activities/Poll";
import { Teams } from "@/components/activities/Teams";
import { useRoomActions } from "@/hooks/useRoomActions";
import { activeParticipantNames } from "@/lib/participants";
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
  const activeMemberNames = activeParticipantNames(state.participants);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <RoomHeader
          name={state.name}
          code={state.code}
          participants={state.participants}
          activeActivity={state.activeActivity}
          appointedAdminIds={state.appointedAdminIds}
          selfId={selfId}
          isAdmin={isAdmin}
          onAppointAdmin={actions.appointAdmin}
          onRevokeAdmin={actions.revokeAdmin}
          onKick={actions.kick}
          onChangeActivity={actions.setActivity}
        />

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
            onSetAnonymous={actions.setAnonymous}
            optionsMenu={isAdmin ? <PokerOptionsMenu deck={state.poker.deck} onSetDeck={actions.setDeck} /> : null}
            historySummary={state.pokerHistorySummary}
            onFetchHistory={actions.fetchPokerHistory}
          />
        )}

        {state.activeActivity === "feedback" && (
          <FeedbackBox
            feedback={state.feedback}
            isAdmin={isAdmin}
            onSubmit={actions.submitFeedback}
            onFetchItems={actions.fetchFeedbackItems}
          />
        )}

        {state.activeActivity === "plinko" && (
          <Plinko
            plinko={state.plinko}
            isAdmin={isAdmin}
            activeMemberNames={activeMemberNames}
            onSetOptions={actions.setPlinkoOptions}
            onSpin={actions.spin}
          />
        )}

        {state.activeActivity === "teams" && (
          <Teams
            teams={state.teams}
            isAdmin={isAdmin}
            activeMemberNames={activeMemberNames}
            onGenerate={actions.generateTeams}
          />
        )}

        {state.activeActivity === "poll" && (
          <Poll
            poll={state.poll}
            isAdmin={isAdmin}
            historySummary={state.pollHistorySummary}
            onFetchHistory={actions.fetchPollHistory}
            onCreate={actions.createPoll}
            onVote={actions.votePoll}
            onSetClosed={actions.setPollClosed}
          />
        )}
      </div>
    </div>
  );
}
