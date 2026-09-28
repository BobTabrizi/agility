# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Node 24 (`.nvmrc`, `engines` in `package.json`, `node:24-alpine` in the `Dockerfile`).
npm 11 warns that `esbuild` and `unrs-resolver` have install scripts "not yet covered by
allowScripts" — they're skipped, and that's fine: both only fetch/verify a platform binary that npm
already installs as an optional dependency (tests, lint and `next build` all pass without them).

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

- **Client IP for rate limits** (`clientIp`, `src/server/clientIp.ts`, unit-tested): the
  connection's address, or with `TRUSTED_PROXY_HOPS=N` the Nth-from-last `X-Forwarded-For` entry
  (the one our own proxy added); never trust `X-Forwarded-For` directly. `server.ts` stamps it on
  every page/API request as `x-agility-client-ip` (always overwriting what the client sent), for
  route handlers. Socket.IO's requests don't pass through that handler, so `socketServer.ts` calls
  `clientIp` on the handshake itself. The room-creation limit (`roomCreationLimiter`,
  `src/server/rateLimit.ts`, 10 per IP per rolling day) lives on `globalThis` like `roomStore`,
  and only counts rooms actually created.

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

- **A room is one main record plus lists stored beside it**, not inside it: poker history rounds,
  poll history, and feedback submissions. The room (`StoredRoom`) only carries counts for them
  (`pokerHistorySummary`, `pollHistorySummary`, `feedback.submissionCount`). In DynamoDB (layout
  comment at the top of `dynamoRoomStore.ts`) that's one table keyed `pk` = room code + `sk`: `ROOM`,
  `HISTORY#<time>#<id>`, `POLL#<createdAt>#<pollId>`, `FEEDBACK#<time>#<id>`. Why: DynamoDB bills
  every write by the whole item's size, so history inside
  the room made each vote ~70x dearer at the 50-round cap; and items max out at 400 KB, which
  uncapped feedback inside the room could eventually hit and break the room. Consequences:
  - A reveal writes the room and its history round in one DynamoDB transaction (`saveRoom(room,
    { pokerRound })`, reached by returning `{ addPokerHistory }` from a `changeRoom` change), so a
    retried reveal can't duplicate or orphan a round. Finished polls work the same way
    (`{ addPollHistory }` → `{ pollResult }`): `finishPoll()` in `socketServer.ts` snapshots a poll
    when it's closed, or when a new poll replaces it while still open (polls with no votes aren't
    recorded, like empty poker rounds). A poll's history item is keyed by its id, so a poll that's
    reopened and closed again overwrites its entry; `poll.recordedAt` keeps it from counting twice
    in `pollHistorySummary`. A plain write that lands on the room
    mid-transaction gets `TransactionConflictException`; `setVote`/`addFeedback` retry that briefly.
  - Feedback submissions are deliberately *not* a transaction (bursts of transactions on one room
    cancel each other): `addFeedback` stores the item, then bumps the count in one `UpdateItem`.
  - History and feedback items expire 60 days after they're *created* (the room's TTL is pushed out
    on every write instead), so old entries age out of a long-lived room on their own. Lists come
    from one `Query` on the sort-key prefix, newest first.
  - **Caps and deletes.** History is capped at the newest `MAX_POKER_HISTORY` / `MAX_POLL_HISTORY`
    (50) when written: the summary `count` is capped too, and once it's at the cap, the save's
    `afterSave` calls `trimHistoryIfFull` → `RoomStore.trimHistory`. Feedback is capped at
    `MAX_FEEDBACK_SUBMISSIONS` (500), checked atomically in `addFeedback`'s count bump (it returns
    `"full"`). Admins delete through `feedback:delete` / `poker:deleteHistory` /
    `poll:deleteHistory` (`{ id }` or `{ all: true }`): the store deletes the items (each one
    conditionally, so two admins deleting the same entry only count it once), then the count is
    lowered — atomically in the store for feedback (its count also changes via direct writes),
    through `changeRoom` for history. The count change is what makes open lists reload, which is
    why the history dialogs watch `count` as well as the latest timestamp.
  - The roster is capped at `MAX_ROOM_PARTICIPANTS` (100) in `room:join`: a newcomer to a full
    room replaces the longest-gone Away non-admin entry (their poll votes stay), else the join is
    rejected with a message.
  - A new room's starting state comes from `newRoom()` (`src/server/newRoom.ts`), shared by both
    stores — add a default for any new `StoredRoom` field there, not per store. Rooms already in
    DynamoDB won't have a newly added field: fill it in on read in `roomFromItem`
    (`dynamoRoomStore.ts`) and the next whole-room save persists it — or, while there's no real
    data yet, wipe the tables instead (as was done when Plinko was replaced).

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
  - **Votes (poker and poll) and feedback submissions are the exception** — the burstiest writes
    (everyone votes or submits at once), so they skip all of the above. `RoomStore.addFeedback` is
    described above; `RoomStore.setPollVote` works like `setVote` (its condition — right poll id,
    open, each id in `poll.optionIds`, several ids only if `multiple` — is built per call, since
    DynamoDB rejects unused placeholder values); `RoomStore.setVote` writes just that voter's field
    (a DynamoDB `UpdateItem` on
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
  - Poker history, poll history and feedback text are never pushed — only their counts, which ride
    along in the room. They're fetched on demand with a request/ack (`poker:getHistory` /
    `poll:getHistory` / `feedback:getItems`, `fetchPokerHistory` / `fetchPollHistory` /
    `fetchFeedbackItems` in `useRoomActions`): the history dialogs fetch when they open, the admin's Anonymous Box when it's shown, and each refetches when its count (or
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

- **Two different kinds of "hidden" data**: some data is withheld server-side — Anonymous Box text
  is never sent to non-admins at all (`feedback:getItems` checks `isRoomAdmin`), and polls are
  shaped per viewer in `toPublicPoll()` (`socketServer.ts`, called from `toPublicState()` for each
  socket): the stored votes never leave the server; a viewer gets counts only once they may see
  results (admin, has voted, or poll closed) and voter names only for a non-anonymous poll.
  Planning Poker's anonymous-voting mode is different: vote values are sent to every client as usual,
  and the UI (`PlanningPoker.tsx`) simply declines to render the per-person mapping. If anonymity ever
  needs to be enforced server-side, that's a `toPublicState()`-style change, not a UI change.
  `pokerHistory` (`poker:reveal` in `socketServer.ts`) takes the stricter approach even for the
  UI-hidden case: for a round revealed under anonymous voting, `name` is recorded as `null` in the
  history entry itself, not just hidden client-side — so a past anonymous round stays anonymous even
  after the toggle is switched off.

- **One connected tab per browser** (`src/lib/tabClaim.ts`, unit-tested): on mount,
  `useRoomConnection` claims the browser over a `BroadcastChannel`; the tab holding it disconnects,
  goes to status `"elsewhere"` (the "open in another tab" screen, whose "Use here" calls
  `takeOver` — a fresh claim), and replies "released". The new tab only connects after that reply
  (or 250ms if no tab answers), so in the same room the old tab's disconnect reaches the server
  before the new join — otherwise the queued `markDisconnected` could run after it and show the
  person as Away. Private windows have their own channel, so they count separately.

- **Two kinds of error on the client** (`useRoomConnection`): a failed `room:join` ack sets `error`
  and is fatal (the room page shows "Couldn't join room"); a `room:error` event is one rejected
  action, so it sets `notice` instead and is shown as a dismissible, auto-hiding `ErrorNotice` over
  the still-working room. New server-side validation errors should go out as `room:error`.
  The join has a 10s timeout (`JOIN_TIMEOUT_MS`), so a reply that never comes shows the error
  screen (with Try again) instead of leaving "Connecting…" up forever.

- **Unexpected errors in socket handlers**: register handlers with the local `on(event, handler)`
  in `initSocketServer`, never `socket.on` directly. It wraps each one in `guardHandler`
  (`src/server/guardHandler.ts`, unit-tested): anything thrown (a DynamoDB failure that outlasted
  the SDK's retries, a bug) is logged as `[socket] <event> failed (room <code>)` — never with the
  payload, which can hold feedback text or an admin token — and the sender is told: a pending ack
  gets `{ ok: false, error }`, otherwise a `room:error`. So handlers can just `await` store calls
  and let unexpected errors throw; only expected outcomes (validation, "busy") need handling
  in the handler. `on()` also spends from the connection's message budget (`createTokenBucket`:
  bursts of `EVENT_BURST` 20, `EVENTS_PER_SECOND` 10 sustained); over budget, the message is
  dropped — an ack gets `{ ok: false, error }`, otherwise a "slow down" `room:error` at most every
  5s. Before that, an `io.use` middleware caps open connections per IP (`MAX_CONNECTIONS_PER_IP`,
  default 20); a refused client gets a `connect_error` that it doesn't retry (`socket.active` is
  false), which `useRoomConnection` shows as the join error screen. Failed actions aren't retried automatically (replaying a reveal or spin could
  do it twice). `feedback:submit` is acked (`FeedbackSubmitResponse`) so the form only clears
  and confirms once the submission is stored; on failure the text stays.

- **Round-reset convention**: any admin action that changes the rules of the current round (changing
  the poker deck, toggling anonymous voting) resets `votes`/`revealed` on the server, so votes cast
  under different rules can't leak into the new state. Follow this pattern for similar settings.

- **Client draft-sync idiom**: components holding a locally-editable draft of a server-pushed value
  that stays mounted while that value can change underneath it (the poker topic input in
  `PlanningPoker.tsx`, Plinko's options textarea, Team Randomizer's name/count inputs, a poll's
  selected options in `Poll.tsx`) pair a draft
  `useState` with a `lastSeenX` `useState`, updated inline during render when the server value
  changes — not a `useEffect`. `useEffect` in this codebase is reserved for actual side effects (e.g.
  the Wheel's and Plinko's `requestAnimationFrame` loops), not for mirroring a prop/server value into local
  state. `PokerDeckModal.tsx` deliberately skips this: it mounts fresh every time the modal opens, so
  a plain `useState(deck.join(", "))` is enough — no risk of the prop changing under an already-open
  draft the way there is for something that stays mounted. The poll editor (`PollEditor`) is the
  same case, and a live poll's view is keyed by poll id so a new poll starts with a fresh selection.

- **Where things live in the room UI** (so new activities follow suit): the activity switcher is the
  dropdown on the activity name in the header (`ActivityMenu.tsx`) — everyone can open it, only
  admins can pick, and non-admins see the options disabled. An activity's history is a
  `HistoryLink` under its card ("View past rounds" / "View past polls"), shown once there's history
  and deliberately without a count (see the component). Per-activity admin settings go in a "⋮" in
  the relevant card's corner (the deck menu, `PokerOptionsMenu`, sits on the card picker).
  An admin's list box (Wheel/Plinko options, Team Randomizer names) gets `UseRoomMembersButton`
  and `ClearDraftButton` beneath it; both edit only the draft, never the room.

- **Mobile** (checked down to 320px wide): form fields use `text-base sm:text-sm` — iOS Safari zooms
  the page when focusing a field under 16px. Dropdowns must stay inside the viewport: the roster's
  `ParticipantMenu` clamps its fixed `left` to the screen, and `ActivityMenu` flips to right-aligned
  when left-aligned would run off the edge. Don't hide important text behind hover-only `title`
  tooltips (there's no hover on a phone) — long topics wrap instead of truncating.
- **Disabled primary (indigo) buttons** turn plain gray (`disabled:bg-neutral-100 disabled:text-neutral-400`,
  dark variants, `cursor-not-allowed`) and only highlight via `enabled:hover:` — a faded indigo
  still read as clickable. Copy the classes from an existing one (e.g. Reveal in `PlanningPoker.tsx`).
  Outlined secondary buttons that can be disabled (Save options, Update) keep `disabled:opacity-40`
  but likewise use `enabled:hover:` / `dark:enabled:hover:` and `disabled:cursor-not-allowed`.

- **Synchronized animations** (Wheel, Plinko): the server decides the outcome *and* everything the
  animation needs (the wheel's `spin` includes `turns` and `offset`; Plinko's `drop` includes the
  whole bounce `path`), so every client plays the identical animation. Plinko is "movie physics": the winner is picked uniformly first (fair to every option), then
  `plinkoPath()` (`src/lib/plinkoPath.ts`, unit-tested) builds a random on-board path into it —
  never simulate real physics for this, since clients would diverge and the outcome couldn't be
  chosen fairly. The Wheel and Plinko share `Confetti.tsx` and `src/lib/chartPalette.ts`.
  Any setting that changes how an animation plays is stamped onto the result itself (Plinko's
  `drop.speed` copies the room's `speed` at drop time), so changing the setting mid-animation can't
  make clients disagree about timing. A new spin/drop id is what triggers it; a result that
  already existed when the component mounted (join, refresh) is shown settled, never replayed. The
  wheel animates with a `requestAnimationFrame` loop that sets the transform directly (no React
  render per frame) — keyframes for its flourishes are in `globals.css` under `.wheel-motion`, which
  `prefers-reduced-motion` switches off (the spin itself then jumps straight to the result).
  Actions that act on a result carry that result's id (`wheel:removeWinner` sends the `spinId` it
  was shown), so if someone produced a newer result in the meantime the server refuses instead of
  acting on the wrong one — follow that for any "do X to the winner" action.
  Testing gotcha: browsers pause `requestAnimationFrame` for a window that isn't being painted
  (e.g. the in-app browser pane when it's hidden or not drawing), so a spin/drop can appear frozen
  after one frame — that's the environment, not the code. To watch one anyway, override
  `window.requestAnimationFrame` with a `setTimeout`-based stand-in in that tab first.

- **Scaling caveat**: a Socket.IO client must stay connected to the instance it joined a room on.
  `ROOM_STORE=dynamodb` solves the room-*data* half of running multiple instances (any instance can
  read/write any room, and the version check keeps concurrent writes from different instances from
  overwriting each other), but not this half — that still needs sticky sessions (session affinity on
  the load balancer) or a Socket.IO adapter (typically Redis) so a broadcast on one instance reaches
  sockets connected to another. Not relevant for local dev or a single instance.
  The post-restart presence check (`checkPresence` in `socketServer.ts`) is single-instance too: it
  marks Away anyone with no socket in the room's channel *on this server*, so with several
  instances it needs the same shared adapter (for `fetchSockets`) — or has to go.

- **Health checks** (`src/server/health.ts`, unit-tested; routes `/api/health` and
  `/api/health/ready`): liveness only checks things a restart fixes (Socket.IO attached — a
  `globalThis` flag set by `initSocketServer`, since API routes don't share `server.ts`'s module
  instances); readiness adds a `getRoom` of a code that can't exist (`HEALTHCHECK`) with a 3s
  timeout. Never put the database in liveness, and never put error details in the response (it's
  public) — log them.

- **Server restarts / reconnects**: the client keeps showing the room when the connection drops
  (`connected` from `useRoomConnection` goes false until the rejoin is acked), with a
  "reconnecting" banner and the room `inert` — anything sent before the rejoin would be ignored by
  the server, so it mustn't be clickable. A rejoin doesn't go back to the full-screen
  "Connecting…" (`join()` keeps status `"joined"`). Server side, the old process can't record who
  left while it was down, so the first join to each room in a process schedules
  `checkPresence` 30s later (`PRESENCE_CHECK_DELAY_MS`), once per room.
  Testing gotcha: the dev server can't show this — Next's dev mode reloads the page when the
  server restarts. Use the `agility-prod` launch config (`.claude/launch.json`: the production
  build on port 3100, after `npm run build`) and restart it with the preview tools, watching from a
  tab the preview tool didn't open (restarting navigates its own tab back to `/`).

- **`RoomStore` contract tests**: `src/server/roomStore.contract.ts` exports
  `testRoomStoreContract(createStore)`, a shared Vitest suite describing the behavior any `RoomStore`
  implementation must have: case-insensitive codes, defaults, persistence, no-op on missing rooms,
  the optimistic-concurrency rules (copies on read, stale saves rejected, concurrent `updateRoom`
  calls all applied), `setVote` (concurrent voters all land, disallowed votes ignored, and a vote
  makes an older whole-room copy stale), `setPollVote` (single vs. multiple choice, unknown option,
  replaced or closed poll, wrong activity, concurrent voters), poll history (atomic with the room
  save, re-recording a poll replaces its entry, newest first, limit), poker history (atomic with the
  room save — a rejected save stores no round; newest first; limit), `addFeedback` (concurrent
  submissions all land, nothing stored for a missing room, the cap refuses and never overshoots
  under concurrency), `deleteFeedback` (one, all, unknown id), `deleteHistory` / `trimHistory` for
  both kinds, and `deleteRoom` taking the lists with it. `roomStore.test.ts` runs it
  against `InMemoryRoomStore`; `dynamoRoomStore.test.ts` runs the *same* suite against a real
  DynamoDB table (only via `npm run test:dynamo`; also needs `DYNAMODB_TEST_TABLE` + AWS credentials
  — see `.env.local`). Run this suite against any future `RoomStore` implementation
  before wiring it into `socketServer.ts`; that's the intended safety net for a backend swap. The
  contract file isn't named `*.test.ts` on purpose, so Vitest doesn't try to execute it directly.

- Path alias `@/*` → `src/*` (`tsconfig.json`).
