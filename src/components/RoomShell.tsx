"use client";

import { RoomHeader } from "@/components/RoomHeader";
import { ActivityTabs } from "@/components/ActivityTabs";
import { PlanningPoker } from "@/components/activities/PlanningPoker";
import { PokerOptionsMenu } from "@/components/activities/PokerOptionsMenu";
import { FeedbackBox } from "@/components/activities/FeedbackBox";
import { Plinko } from "@/components/activities/Plinko";
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
  // Nothing useful behind the poker menu for a non-admin until there's history to look at.
  const showPokerOptions =
    state.activeActivity === "poker" && (isAdmin || state.pokerHistorySummary.count > 0);

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
        />

        {/* Participants see the current activity in the header, so this row is
            the admin's activity switcher plus the poker menu — and isn't
            rendered at all when a participant has neither, so it doesn't leave
            an empty gap. */}
        {(isAdmin || showPokerOptions) && (
          <div className="flex items-center gap-2">
            {isAdmin && <ActivityTabs active={state.activeActivity} onChange={actions.setActivity} />}
            {showPokerOptions && (
              <div className="ml-auto">
                <PokerOptionsMenu
                  historySummary={state.pokerHistorySummary}
                  onFetchHistory={actions.fetchPokerHistory}
                  deck={state.poker.deck}
                  isAdmin={isAdmin}
                  onSetDeck={actions.setDeck}
                />
              </div>
            )}
          </div>
        )}

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
          />
        )}

        {state.activeActivity === "feedback" && (
          <FeedbackBox feedback={state.feedback} isAdmin={isAdmin} onSubmit={actions.submitFeedback} />
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
      </div>
    </div>
  );
}
