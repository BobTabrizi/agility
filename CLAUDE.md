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
npm test           # vitest run — runs once and exits
npm run test:watch  # vitest — watch mode
```

Tests run via Vitest (`vitest.config.ts` aliases `@/*` to `src/*`, matching `tsconfig.json`), not through
`tsx`/the custom server — they don't touch the running dev server or its in-memory rooms. Unlike the app
itself, Vitest has no built-in `.env.local` loading (that's a Next.js-only convention), so
`vitest.config.ts` loads it explicitly via `dotenv` — needed for `DYNAMODB_TEST_TABLE` and AWS credentials
to reach `dynamoRoomStore.test.ts`.

Editing anything under `src/server/` or `server.ts` restarts the whole `tsx watch` process, which wipes
all in-memory rooms (see below) — recreate any room you were testing against after server-side edits.

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
  nothing changes. Every socket event handler in `socketServer.ts` follows the same shape: validate
  the payload, mutate `room`, `await
  roomStore.saveRoom(room)`, then `await broadcastRoomState(io, code)` to push the full room state to
  everyone in that room's Socket.IO channel. Clients never mutate activity state locally — they call an
  action from `src/hooks/useRoomActions.ts` (a thin wrapper emitting a socket event) and wait for the
  resulting broadcast to update the UI via `useRoomConnection`.

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
    handlers start with `const room = await loadRoomAsAdmin(socket); if (!room) return;`, which
    re-checks the token against the room on every call, so a revocation takes effect immediately.
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

- **Two different kinds of "hidden" data**: `toPublicState()` in `socketServer.ts` is where
  server-side stripping happens — e.g. Feedback Box items are never sent to non-admin sockets at all.
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
  read/write any room), but not this half — that still needs sticky sessions (session affinity on
  the load balancer) or a Socket.IO adapter (typically Redis) so a broadcast on one instance reaches
  sockets connected to another. Not relevant for local dev or a single instance.

- **`RoomStore` contract tests**: `src/server/roomStore.contract.ts` exports `testRoomStoreContract(createStore)`,
  a shared Vitest suite describing the behavior any `RoomStore` implementation must have (case-insensitive
  codes, defaults, persistence, no-op on missing rooms, etc.). `roomStore.test.ts` runs it against
  `InMemoryRoomStore`; `dynamoRoomStore.test.ts` runs the *same* suite against a real DynamoDB table
  (skipped unless `DYNAMODB_TEST_TABLE` + AWS credentials are set — see `.env.local`). Run this suite
  against any future `RoomStore` implementation before wiring it into `socketServer.ts`; that's the
  intended safety net for a backend swap. The contract file isn't named `*.test.ts` on purpose, so
  Vitest doesn't try to execute it directly.

- Path alias `@/*` → `src/*` (`tsconfig.json`).
