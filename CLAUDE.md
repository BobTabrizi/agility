# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm install       # install deps
npm run dev        # runs server.ts via `tsx watch` — NOT `next dev`; this is what wires up Socket.IO
npm run build       # next build
npm start          # production: cross-env NODE_ENV=production tsx server.ts (runs server.ts, not `next start`)
npm run lint        # eslint
npx tsc --noEmit -p tsconfig.json   # type-check (no dedicated script)
npm test           # vitest run — runs once and exits; never touches AWS
npm run test:watch  # vitest — watch mode
npm run test:dynamo # the DynamoDB suite, against a real pay-per-request table — opt-in, see below
```

**Keep AWS usage deliberate.** Both DynamoDB tables are on-demand (billed per request), and the owner
wants to stay well inside free-tier/credit limits:
- `npm test` skips `dynamoRoomStore.test.ts` (it needs `RUN_DYNAMODB_TESTS=1`, which only
  `npm run test:dynamo` sets). Run `test:dynamo` once after changing `RoomStore`, `DynamoRoomStore` or
  `roomUpdates.ts` — not on every edit, and not in a watch loop.
- The dev server uses DynamoDB whenever `.env.local` has `ROOM_STORE=dynamodb`, so load tests or
  scripted multi-client runs against it (dozens of simulated voters, many rounds) are real billed
  writes. Prefer the unit tests and the in-memory store for that kind of testing, and ask before
  running anything heavy against a DynamoDB-backed server.

Tests run via Vitest (`vitest.config.ts` aliases `@/*` to `src/*`, matching `tsconfig.json`), not through
`tsx`/the custom server — they don't touch the running dev server or its in-memory rooms. Unlike the app
itself, Vitest has no built-in `.env.local` loading (that's a Next.js-only convention), so
`vitest.config.ts` loads it explicitly via `dotenv` — needed for `DYNAMODB_TEST_TABLE` and AWS credentials
to reach `dynamoRoomStore.test.ts` (when opted in via `test:dynamo`).

Editing anything under `src/server/` or `server.ts` restarts the whole `tsx watch` process, which wipes
all in-memory rooms (see below) — recreate any room you were testing against after server-side edits.

Only one dev server can run at a time: a second `npm run dev` (or a second `tsx watch` restarting)
fails with "Another next dev server is already running" while another holds the lock, even though
port 3000 keeps answering — check which process owns the port before assuming your changes loaded.

## Architecture

- **Custom server**: `server.ts` creates a plain Node HTTP server, hands it to Next's request handler,
  and attaches a Socket.IO server (`initSocketServer` in `src/server/socketServer.ts`) to the same
  HTTP server. This is why dev/start run `server.ts` directly instead of the standard `next dev`/`next
  start` — a long-lived process is required for Socket.IO.

- **`initSocketServer` is imported dynamically inside `app.prepare().then(...)`, not as a static
  top-level import.** This matters: `next({...})` loads `.env.local` synchronously in its own
  constructor, but ES module imports resolve their whole chain before any code in the importing file
  runs — a static top-level import of `socketServer.ts` (which transitively imports `roomStore.ts`,
  which reads `process.env.ROOM_STORE` at module-load time) would evaluate *before* `next({...})` is
  even called, seeing an empty environment. This actually happened: `ROOM_STORE=dynamodb` silently
  fell back to `InMemoryRoomStore` with no error, and only became obvious when a room didn't survive
  a server restart. Anything importing `roomStore.ts`, directly or transitively, from `server.ts`
  must stay after that line.

- **Server-authoritative real-time state**: all room state (`RoomState`, `src/lib/types.ts`) lives in
  `roomStore` (`src/server/roomStore.ts`), an `InMemoryRoomStore` by default behind a `RoomStore`
  interface. A `DynamoRoomStore` (`src/server/dynamoRoomStore.ts`) also exists — set
  `ROOM_STORE=dynamodb` + `DYNAMODB_TABLE_NAME` (plus AWS credentials) to use it instead; unset,
  nothing changes. Every room-changing socket handler in `socketServer.ts` follows the same shape:
  validate the payload, then `changeRoom(socket, { adminOnly? }, (room) => { ...mutate room... })`,
  which saves it and broadcasts the room state to everyone in that room's Socket.IO channel (grouped
  — see "Broadcasts" below).
  Clients never mutate activity state locally — they call an action from `src/hooks/useRoomActions.ts`
  (a thin wrapper emitting a socket event) and wait for the resulting broadcast to update the UI via
  `useRoomConnection`.

- **A room is one main record plus two lists stored beside it**, not inside it: poker history rounds
  and feedback submissions. The room (`StoredRoom`) only carries counts for them
  (`pokerHistorySummary`, `feedback.submissionCount`). In DynamoDB (layout comment at the top of
  `dynamoRoomStore.ts`) that's one table keyed `pk` = room code + `sk`: `ROOM`, `HISTORY#<time>#<id>`,
  `FEEDBACK#<time>#<id>`. Why: DynamoDB bills every write by the whole item's size, so history inside
  the room made each vote ~70x dearer at the 50-round cap; and items max out at 400 KB, which
  uncapped feedback inside the room could eventually hit and break the room. Consequences:
  - A reveal writes the room and its history round in one DynamoDB transaction (`saveRoom(room,
    historyEntry)`, reached by returning `{ addPokerHistory }` from a `changeRoom` change), so a
    retried reveal can't duplicate or orphan a round. A plain write that lands on the room
    mid-transaction gets `TransactionConflictException`; `setVote`/`addFeedback` retry that briefly.
  - Feedback submissions are deliberately *not* a transaction (bursts of transactions on one room
    cancel each other): `addFeedback` stores the item, then bumps the count in one `UpdateItem`.
  - History and feedback items expire 60 days after they're *created* (the room's TTL is pushed out
    on every write instead), so old entries age out of a long-lived room on their own. Lists come
    from one `Query` on the sort-key prefix, newest first; history is capped at the newest
    `MAX_POKER_HISTORY` (50) when read, not when written.
  - A new room's starting state comes from `newRoom()` (`src/server/newRoom.ts`), shared by both
    stores — add a default for any new `StoredRoom` field there, not per store.

- **Concurrent writes — never `getRoom` + `saveRoom` by hand.** Two handlers editing the same room at
  once (two people voting) used to silently lose one change: each loaded the room, changed its own
  copy, and the second save overwrote the first. Now:
  - Rooms carry a server-only `version`. `saveRoom` only writes if the stored room is still at the
    version that was read (a DynamoDB condition expression; a check in `InMemoryRoomStore`), and
    throws `RoomConflictError` otherwise. `getRoom` always returns an independent copy — the
    in-memory store too, which used to hand out its live object (that's why the bug only appeared
    with DynamoDB).
  - `updateRoom` (`src/server/roomUpdates.ts`) is the read-modify-write loop: it re-reads and
    re-applies the change on conflict, with jittered exponential backoff, and gives up with
    `RoomBusyError` (reported to the user as "the room is busy") after several attempts.
  - Because a change can run more than once, it must only read/modify the room it's given — ids,
    timestamps and random picks are fine (each attempt makes fresh ones) — and must not emit to
    sockets. Return `SKIP` to save nothing, `{ error }` to reject with a message; socket side
    effects go in `changeRoom`'s `afterSave` (see `admin:appoint`, `participant:kick`).
  - On top of that, the socket layer queues whole-room updates per room within the process
    (`createKeyedQueue`), so a burst from one instance runs one at a time instead of piling into
    retries; the version check then only has to catch writes from other instances. Each queued
    update costs a read + a write (~60ms from a dev machine to AWS, a few ms in-region).
  - **Votes and feedback submissions are the exception** — the burstiest writes (everyone votes or
    submits at once), so they skip all of the above. `RoomStore.addFeedback` is described above;
    `RoomStore.setVote` writes just that voter's field (a DynamoDB `UpdateItem` on
    `poker.votes.<participantId>`), with the rules (poker active, not revealed, card is in the
    current deck) as a condition checked at write time. No read, no queue, no conflicts between
    voters. It still bumps `version`, which is what lets the two paths mix: a whole-room save that
    read before a vote landed conflicts and re-applies on top of it rather than dropping the vote.
    40 simultaneous voters settle in well under a second (vs ~2.7s through the queue). If another
    action turns out to be bursty, give it the same treatment rather than routing it through
    `changeRoom`.

- **Broadcasts** (`broadcastRoomState` in `socketServer.ts`):
  - They send the room the write returned (no re-read), and concurrent writes mean they can reach
    clients out of order — the burst test saw several per 40 votes. Every snapshot carries `version`,
    and `useRoomConnection` keeps the highest one it has seen; don't bypass that when touching
    `room:state` handling.
  - They're grouped per room (`createVersionedThrottle`, `src/server/roomThrottle.ts`): a lone change
    goes out immediately, and further changes within 50ms collapse into one send of the newest
    version. A 40-vote burst reaches each client as ~4–11 updates instead of 40. Each broadcast is
    one JSON serialization per connected socket (admins and participants get different views), so
    this is where the CPU goes in a busy room.
  - Poker history and feedback text are never pushed — only their counts, which ride along in the
    room. They're fetched on demand with a request/ack (`poker:getHistory` / `feedback:getItems`,
    `fetchPokerHistory` / `fetchFeedbackItems` in `useRoomActions`): the history dialog fetches when
    it opens, the admin's Feedback Box when it's shown, and each refetches when its count (or
    `latestRevealedAt`) changes while open — so only people actually looking download the lists.
    Anything else that's large and only occasionally viewed should follow the same pattern.

- `roomStore` is stashed on `globalThis` (`__agilityRoomStore`) so it survives module re-evaluation
  across hot reloads in dev.

- **Admin identity**: there are no accounts — admin is whoever holds a valid admin token. The creator's
  token (`room.adminToken`) is minted on room creation (`POST /api/rooms` → `roomStore.createRoom`);
  any admin can appoint another *connected* participant (`admin:appoint`), which mints a separate
  per-person token in `room.appointedAdminTokens` (participantId → token) and hands it to that
  person's live socket(s) via `admin:granted`. The client stores it (same `localStorage` key as the
  creator's, `src/lib/storage.ts`) and echoes it back with `room:auth`, so no rejoin is needed.
  Appointed admins can be removed (`admin:revoke`, including stepping down yourself); the creator
  can't, so a room always has at least one admin.
  - Tokens, not participant ids, are what grant admin: participant ids are broadcast to every client,
    so anything keyed on the id alone would let anyone claim it. Appointed tokens are also bound to
    the participant they were issued to (`isRoomAdmin` in `socketServer.ts`). This is also why an
    Away participant can't be appointed — there'd be no safe way to deliver their token later.
  - `socket.data` holds the presented `adminToken`, never a cached `isAdmin` boolean: admin-only
    handlers use `changeRoom(socket, { adminOnly: true }, ...)`, which re-checks the token against
    the latest room inside the change itself (so on every retry too), so a revocation takes effect
    immediately.
  - Clients read their own admin status from `state.viewerIsAdmin` (set per socket in
    `toPublicState()`), not the join ack, since it can change mid-session. `appointedAdminIds` tells
    admins which roster entries are removable. `Participant.isAdmin` is only a roster display flag
    ("is an admin of this room"): it's true for anyone in `appointedAdminTokens` even when their
    current connection didn't present the token, so the roster never contradicts `appointedAdminIds`.
  - **Kicking** (`participant:kick`): any admin can kick anyone except themselves and the creator.
    It deletes the roster entry (not just Away), their poker vote, and any appointed admin token,
    then emits `room:kicked` and disconnects every socket with that participant id. The disconnect
    is server-side on purpose — Socket.IO clients don't auto-reconnect from those — which is also
    why `useRoomConnection` calls `socket.connect()` when it mounts on a disconnected shared socket.
    It is deliberately not a ban: the kicked person can rejoin (the kicked page has a Rejoin
    button) and comes back as a fresh participant. Kicking an Away participant is how the roster
    gets pruned.
  - Admin actions on a person live in the roster's per-row "⋮" menu (`ParticipantMenu.tsx`), which
    is `position: fixed` because the roster list scrolls and would clip an absolute dropdown.
    Roster names are cut at `MAX_DISPLAY_NAME_LENGTH` (`truncateName`, `src/lib/participants.ts`);
    the full-name tooltip is set on hover, since only the rendered width says whether CSS
    `truncate` clipped it further.

- **Two different kinds of "hidden" data**: some data is withheld server-side — Feedback Box text
  is never sent to non-admins at all (`feedback:getItems` checks `isRoomAdmin`; `toPublicState()` in
  `socketServer.ts` is where per-socket stripping of pushed state would go).
  Planning Poker's anonymous-voting mode is different: vote values are sent to every client as usual,
  and the UI (`PlanningPoker.tsx`) simply declines to render the per-person mapping. If anonymity ever
  needs to be enforced server-side, that's a `toPublicState()`-style change, not a UI change.
  `pokerHistory` (`poker:reveal` in `socketServer.ts`) takes the stricter approach even for the
  UI-hidden case: for a round revealed under anonymous voting, `name` is recorded as `null` in the
  history entry itself, not just hidden client-side — so a past anonymous round stays anonymous even
  after the toggle is switched off.

- **Two kinds of error on the client** (`useRoomConnection`): a failed `room:join` ack sets `error`
  and is fatal (the room page shows "Couldn't join room"); a `room:error` event is one rejected
  action, so it sets `notice` instead and is shown as a dismissible, auto-hiding `ErrorNotice` over
  the still-working room. New server-side validation errors should go out as `room:error`.

- **Round-reset convention**: any admin action that changes the rules of the current round (changing
  the poker deck, toggling anonymous voting) resets `votes`/`revealed` on the server, so votes cast
  under different rules can't leak into the new state. Follow this pattern for similar settings.

- **Client draft-sync idiom**: components holding a locally-editable draft of a server-pushed value
  that stays mounted while that value can change underneath it (the poker topic input in
  `PlanningPoker.tsx`, Plinko's options textarea, Team Randomizer's name/count inputs) pair a draft
  `useState` with a `lastSeenX` `useState`, updated inline during render when the server value
  changes — not a `useEffect`. `useEffect` in this codebase is reserved for actual side effects (e.g.
  Plinko's chained-`setTimeout` reveal animation), not for mirroring a prop/server value into local
  state. `PokerDeckModal.tsx` deliberately skips this: it mounts fresh every time the modal opens, so
  a plain `useState(deck.join(", "))` is enough — no risk of the prop changing under an already-open
  draft the way there is for something that stays mounted.

- **Scaling caveat**: a Socket.IO client must stay connected to the instance it joined a room on.
  `ROOM_STORE=dynamodb` solves the room-*data* half of running multiple instances (any instance can
  read/write any room, and the version check keeps concurrent writes from different instances from
  overwriting each other), but not this half — that still needs sticky sessions (session affinity on
  the load balancer) or a Socket.IO adapter (typically Redis) so a broadcast on one instance reaches
  sockets connected to another. Not relevant for local dev or a single instance.

- **`RoomStore` contract tests**: `src/server/roomStore.contract.ts` exports
  `testRoomStoreContract(createStore)`, a shared Vitest suite describing the behavior any `RoomStore`
  implementation must have: case-insensitive codes, defaults, persistence, no-op on missing rooms,
  the optimistic-concurrency rules (copies on read, stale saves rejected, concurrent `updateRoom`
  calls all applied), `setVote` (concurrent voters all land, disallowed votes ignored, and a vote
  makes an older whole-room copy stale), poker history (atomic with the room save — a rejected save
  stores no round; newest first; limit), `addFeedback` (concurrent submissions all land, nothing
  stored for a missing room), and `deleteRoom` taking the lists with it. `roomStore.test.ts` runs it
  against `InMemoryRoomStore`; `dynamoRoomStore.test.ts` runs the *same* suite against a real
  DynamoDB table (only via `npm run test:dynamo`; also needs `DYNAMODB_TEST_TABLE` + AWS credentials
  — see `.env.local`). Run this suite against any future `RoomStore` implementation
  before wiring it into `socketServer.ts`; that's the intended safety net for a backend swap. The
  contract file isn't named `*.test.ts` on purpose, so Vitest doesn't try to execute it directly.

- Path alias `@/*` → `src/*` (`tsconfig.json`).
