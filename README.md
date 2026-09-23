# Agility

A room-based app for team activities: planning poker, an anonymous feedback box, and plinko.

Anyone can create a room and share its link with their team. The creator becomes the room
admin (tracked via a token stored in their browser, not an account); everyone else joins as a
participant by picking a display name. Admin and participants stay in sync in real time over a
Socket.IO connection.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind** for the UI and API routes.
- **Socket.IO**, attached to a custom Node server (`server.ts`) alongside the Next.js request
  handler, for real-time room state. Socket.IO was chosen over Vercel-style serverless functions
  because it needs a long-lived server process — this fits naturally on the AWS compute you're
  planning to move to (ECS/EC2/Elastic Beanstalk), whereas serverless platforms don't support
  persistent WebSocket connections well.
- **In-memory room store** (`src/server/roomStore.ts`) behind a small `RoomStore` interface.
  Rooms currently live only in server memory and expire after 6 hours of inactivity. The
  interface is there so this can be swapped for a DynamoDB-backed implementation later without
  touching the Socket.IO layer.

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
- **Join a room** via `/room/<CODE>` (the "Copy invite link" button in a room grabs this for you).
  New participants just pick a display name — no account needed. Each browser gets a stable
  per-room identity (`agility:client:<code>` in `localStorage`), so refreshing the page or
  reconnecting reactivates the same roster entry rather than joining as a new person.
- **Who's in the room**: the avatar cluster in the header shows who's currently connected;
  clicking it opens the full roster of everyone who has ever joined, with anyone not currently
  connected grayed out and labeled "Away" rather than removed.
- **Activities**: the admin picks which activity is active for the whole room (Planning Poker,
  Feedback Box, Plinko, or Team Randomizer) via the tabs at the top; everyone in the room sees the
  same activity.
  - **Planning Poker** — deck is admin-customizable (numbers, sizes, or short text options),
    votes are hidden until the admin reveals them, then shows each vote plus the average of
    numeric votes. An anonymous-voting toggle hides who voted what (names stay visible, values
    don't) and resets the round when flipped.
  - **Feedback Box** — participants submit free-text feedback with no name attached; only the
    admin can see submitted messages (others just see a running submission count).
  - **Plinko** — admin enters a list of options, "Drop the ball" picks one at random server-side
    and every client plays the same reveal animation.
  - **Team Randomizer** — admin enters a list of names and a desired team count; "Generate teams"
    shuffles the names server-side and splits them round-robin into that many teams.

## Deploying (AWS, later)

The app stays in-memory for now — no AWS resources are set up yet — but it's built to be
container-deployable without changes:

- A `Dockerfile` at the repo root builds and runs the app (`docker build -t agility .` /
  `docker run -p 3000:3000 agility`). It's a single, un-optimized stage (keeps devDependencies,
  since the production start script runs `server.ts` via `tsx` rather than precompiled JS) — fine
  to run as-is, but worth slimming down (multi-stage build, compiled server) once you're actually
  tuning for cost/cold-start on ECS/App Runner.
- The server binds to `0.0.0.0` (not `localhost`), so it's reachable from outside the container.
- `GET /api/health` returns `{ status: "ok" }` for use as an ALB target group / ECS task health
  check.
- **Caveat for scaling to multiple instances**: room state lives in each server process's memory,
  and Socket.IO needs a client to stay connected to the same instance it joined a room on. Running
  more than one task/instance behind a load balancer will require either sticky sessions (session
  affinity on the ALB) or moving room state to something shared (e.g. DynamoDB + a Socket.IO
  Redis/DynamoDB adapter) — not needed for a single instance.

## Notes / known limitations (fine for an MVP, worth revisiting before wider use)

- No accounts: whoever holds the admin token in their browser is the admin. Clearing site data or
  switching devices loses admin access to a room (the room itself is unaffected).
- Roster entries are never removed once someone joins — the room's participant list only ever
  grows for the life of the room (no pruning of long-"Away" entries yet). Fine for a single
  working session; worth revisiting if rooms end up staying open for a very long time with lots
  of churn.
- Disconnecting (closing the tab, refreshing, losing connectivity) clears that participant's
  current poker vote and marks them "Away" — "X of Y voted" and the vote grid only ever count
  currently-connected people. Reconnecting (same browser, same room) puts them back as a normal
  participant, but they'll need to vote again.
- Two tabs open to the same room in the same browser share one identity (same stored client id),
  so closing either one will mark that person "Away" even if the other tab is still open. Edge
  case, not handled.
- Room data is in-memory only — restarting the server clears all rooms. Swap
  `InMemoryRoomStore` in `src/server/roomStore.ts` for a persistent implementation (e.g.
  DynamoDB) when that matters.
