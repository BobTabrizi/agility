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
```

There is no test suite/runner configured in this repo.

Editing anything under `src/server/` or `server.ts` restarts the whole `tsx watch` process, which wipes
all in-memory rooms (see below) — recreate any room you were testing against after server-side edits.

## Architecture

- **Custom server**: `server.ts` creates a plain Node HTTP server, hands it to Next's request handler,
  and attaches a Socket.IO server (`initSocketServer` in `src/server/socketServer.ts`) to the same
  HTTP server. This is why dev/start run `server.ts` directly instead of the standard `next dev`/`next
  start` — a long-lived process is required for Socket.IO.

- **Server-authoritative real-time state**: all room state (`RoomState`, `src/lib/types.ts`) lives in
  `roomStore` (`src/server/roomStore.ts`), currently an `InMemoryRoomStore` behind a `RoomStore`
  interface (swappable for a persistent store, e.g. DynamoDB, later). Every socket event handler in
  `socketServer.ts` follows the same shape: validate the payload, mutate `room`, `await
  roomStore.saveRoom(room)`, then `await broadcastRoomState(io, code)` to push the full room state to
  everyone in that room's Socket.IO channel. Clients never mutate activity state locally — they call an
  action from `src/hooks/useRoomActions.ts` (a thin wrapper emitting a socket event) and wait for the
  resulting broadcast to update the UI via `useRoomConnection`.

- `roomStore` is stashed on `globalThis` (`__agilityRoomStore`) so it survives module re-evaluation
  across hot reloads in dev.

- **Admin identity**: there are no accounts — whoever holds a room's `adminToken` is the admin. The
  token is minted on room creation (`POST /api/rooms` → `roomStore.createRoom`) and stored client-side
  per room code in `localStorage` (`src/lib/storage.ts`). On `room:join`, the server sets
  `socket.data.isAdmin` by comparing the submitted token against `room.adminToken`; admin-only socket
  handlers guard with `if (!requireAdmin(socket)) return;`.

- **Two different kinds of "hidden" data**: `toPublicState()` in `socketServer.ts` is where
  server-side stripping happens — e.g. Feedback Box items are never sent to non-admin sockets at all.
  Planning Poker's anonymous-voting mode is different: vote values are sent to every client as usual,
  and the UI (`PlanningPoker.tsx`) simply declines to render the per-person mapping. If anonymity ever
  needs to be enforced server-side, that's a `toPublicState()`-style change, not a UI change.

- **Round-reset convention**: any admin action that changes the rules of the current round (changing
  the poker deck, toggling anonymous voting) resets `votes`/`revealed` on the server, so votes cast
  under different rules can't leak into the new state. Follow this pattern for similar settings.

- **Client draft-sync idiom**: components holding a locally-editable draft of a server-pushed value
  (the poker topic input and deck-editor input in `PlanningPoker.tsx`, Plinko's options textarea) pair
  a draft `useState` with a `lastSeenX` `useState`, updated inline during render when the server value
  changes — not a `useEffect`. `useEffect` in this codebase is reserved for actual side effects (e.g.
  Plinko's chained-`setTimeout` reveal animation), not for mirroring a prop/server value into local
  state.

- **Scaling caveat**: room state is per-process memory, and a Socket.IO client must stay connected to
  the instance it joined a room on. Running more than one instance behind a load balancer needs sticky
  sessions or a shared store — not relevant for local dev or a single instance.

- Path alias `@/*` → `src/*` (`tsconfig.json`).
