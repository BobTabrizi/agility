# Agility

A room-based app for team activities: planning poker, an anonymous feedback box, plinko, and a
team randomizer.

Anyone can create a room and share its link with their team. The creator becomes the room's
first admin (tracked via a token stored in their browser, not an account) and can make others
admins too; everyone else joins as a participant by picking a display name. Admins and
participants stay in sync in real time over a Socket.IO connection.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind** for the UI and API routes.
- **Socket.IO**, attached to a custom Node server (`server.ts`) alongside the Next.js request
  handler, for real-time room state. Socket.IO was chosen over Vercel-style serverless functions
  because it needs a long-lived server process — this fits naturally on the AWS compute you're
  planning to move to (ECS/EC2/Elastic Beanstalk), whereas serverless platforms don't support
  persistent WebSocket connections well.
- **Room storage** sits behind a `RoomStore` interface (`src/server/roomStore.ts`) so the
  Socket.IO layer never depends on which backend is active. Defaults to `InMemoryRoomStore`
  (rooms live only in server memory — lost on restart). A `DynamoRoomStore`
  (`src/server/dynamoRoomStore.ts`) also exists, backed by a real DynamoDB table; opt into it by
  setting `ROOM_STORE=dynamodb` and `DYNAMODB_TABLE_NAME=<your table>` in `.env.local`, alongside
  standard AWS credential/region env vars (`AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, or a named profile). Either way, rooms with no activity for 60 days are
  cleaned up — an app-level sweep for the in-memory store, DynamoDB's native TTL for the Dynamo one.

## Running locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). `npm run dev` runs the custom server
(`server.ts`) via `tsx watch`, not `next dev` directly — this is what wires up Socket.IO.

`npm run build` / `npm start` build and run the production Next.js app through the same custom
server.

`npm test` runs the test suite (Vitest) once; `npm run test:watch` runs it in watch mode.

## How rooms work

- **Create a room** on the home page: you pick a team/workspace name and your own display name.
  The server generates a 6-character room code and an admin token; the token is stored in
  `localStorage` on your device only (`agility:admin:<code>`) and is what marks you as admin when
  you connect.
- **Join a room** via `/room/<CODE>` — the "Copy invite link" button in a room opens a modal with
  the link, a QR code (scannable to join from a phone), and a one-click copy. New participants
  just pick a display name — no account needed. Each browser gets a stable
  per-room identity (`agility:client:<code>` in `localStorage`), so refreshing the page or
  reconnecting reactivates the same roster entry rather than joining as a new person.
- **Who's in the room**: the avatar cluster in the header shows who's currently connected;
  clicking it opens the full roster of everyone who has joined (unless they were kicked), with
  anyone not currently connected grayed out and labeled "Away" rather than removed. Names longer
  than 30 characters are shortened there, with the full name on hover. Admins get a "⋮" menu next
  to each name for the actions below.
- **More than one admin**: any admin can make someone else in the room an admin from that menu
  ("Make admin"), as long as that person is currently connected. They get their own admin token,
  stored the same way. Any admin can remove an appointed admin (or step down themselves); the
  room's creator always stays an admin. A new admin can read everything already in the Feedback
  Box, not just what's submitted after they were appointed.
- **Kicking**: admins can also "Kick from room" from that menu (after a confirmation). The person is
  disconnected, their vote is cleared, they lose admin if they had it, and they're removed from the
  roster entirely. It isn't a ban — they see a "You were removed" screen and can rejoin with the
  invite link. The creator can't be kicked, and you can't kick yourself. Kicking someone who's
  "Away" is a way to tidy up the roster.
- **Activities**: an admin picks which activity is active for the whole room (Planning Poker,
  Feedback Box, Plinko, or Team Randomizer) via the tabs at the top; everyone in the room sees the
  same activity.
  - **Planning Poker** — deck is admin-customizable (numbers, sizes, or short text options),
    votes are hidden until an admin reveals them, then shows each vote plus the average of
    numeric votes. An anonymous-voting toggle hides who voted what (names stay visible, values
    don't) and resets the round when flipped. Past rounds are kept as poker history (topic, votes,
    average), reachable from the "⋮" menu next to the activity tabs — anonymous rounds stay
    anonymous in history even if the toggle is switched off later.
  - **Feedback Box** — participants submit free-text feedback with no name attached; only
    admins can see submitted messages (others just see a running submission count).
  - **Plinko** — an admin enters a list of options, "Drop the ball" picks one at random server-side
    and every client plays the same reveal animation.
  - **Team Randomizer** — an admin enters a list of names and a desired team count; "Generate teams"
    shuffles the names server-side and splits them round-robin into that many teams.

## Deploying (AWS, later)

Nothing runs on AWS compute yet — the app still runs locally via `npm run dev`/`npm start` — but
storage is already AWS-ready: `DynamoRoomStore` (see above) is real and tested against an actual
DynamoDB table, just not the default. The app is also built to be container-deployable without
changes:

- A `Dockerfile` at the repo root builds and runs the app (`docker build -t agility .` /
  `docker run -p 3000:3000 agility`). It's a single, un-optimized stage (keeps devDependencies,
  since the production start script runs `server.ts` via `tsx` rather than precompiled JS) — fine
  to run as-is, but worth slimming down (multi-stage build, compiled server) once you're actually
  tuning for cost/cold-start on ECS/App Runner.
- The server binds to `0.0.0.0` (not `localhost`), so it's reachable from outside the container.
- `GET /api/health` returns `{ status: "ok" }` for use as an ALB target group / ECS task health
  check.
- **Caveat for scaling to multiple instances**: switching to `DynamoRoomStore` solves the room-data
  half of this (any instance can read/write any room), but Socket.IO still needs a client to stay
  connected to the same instance it joined a room on — that half needs either sticky sessions
  (session affinity on the ALB) or a Socket.IO adapter (typically Redis) so broadcasts reach
  sockets connected to other instances. Not needed for a single instance.

## Notes / known limitations (fine for an MVP, worth revisiting before wider use)

- No accounts: whoever holds an admin token in their browser is an admin. Clearing site data or
  switching devices loses admin access to a room (the room itself is unaffected) — though another
  admin can re-appoint you on the new device.
- Roster entries are only removed when an admin kicks them — there's no automatic pruning of
  long-"Away" entries, so in a long-lived room with lots of churn the list keeps growing until an
  admin tidies it up.
- Kicking isn't a ban: without accounts there's nothing durable to ban, so a kicked person can
  simply rejoin.
- Disconnecting (closing the tab, refreshing, losing connectivity) clears that participant's
  current poker vote and marks them "Away" — "X of Y voted" and the vote grid only ever count
  currently-connected people. Reconnecting (same browser, same room) puts them back as a normal
  participant, but they'll need to vote again.
- Two tabs open to the same room in the same browser share one identity (same stored client id),
  so closing either one will mark that person "Away" even if the other tab is still open. Edge
  case, not handled.
- Room data is in-memory only by default — restarting the server clears all rooms unless
  `ROOM_STORE=dynamodb` is set (see above), in which case a `DynamoRoomStore` persists rooms in a
  real DynamoDB table instead.
