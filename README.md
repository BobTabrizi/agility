# Agility

A room-based app for team activities: planning poker, an Anonymous Box for feedback, an animated
Plinko board, a team randomizer, polls, and a spinning wheel.

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
  Writes are versioned, so simultaneous changes to a room (people voting at the same moment) can't
  overwrite each other.
- **DynamoDB table setup** (for `DYNAMODB_TABLE_NAME`, and a second identical table for
  `DYNAMODB_TEST_TABLE` if you run `npm run test:dynamo`): partition key `pk` (String), sort key
  `sk` (String), on-demand capacity, and TTL turned on for the attribute `expiresAt`. Each room is
  a `ROOM` item plus one small item per poker round, per finished poll and per feedback
  submission, so no item grows without bound. The access key needs `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`,
  `BatchWriteItem` and `ConditionCheckItem` on both tables.

## Running locally

Requires **Node 24** (LTS; pinned in `.nvmrc` and `package.json` `engines`, and used by the
`Dockerfile`).

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). `npm run dev` runs the custom server
(`server.ts`) via `tsx watch`, not `next dev` directly — this is what wires up Socket.IO.

`npm run build` / `npm start` build and run the production Next.js app through the same custom
server.

`npm test` runs the test suite (Vitest) once; `npm run test:watch` runs it in watch mode. Neither
touches AWS: the DynamoDB tests run against a real (pay-per-request) table, so they're opt-in via
`npm run test:dynamo` — worth running after changing the room storage code, not on every edit.

## How rooms work

- **Create a room** on the home page: you pick a team/workspace name and your own display name.
  The server generates a 6-character room code and an admin token; the token is stored in
  `localStorage` on your device only (`agility:admin:<code>`) and is what marks you as admin when
  you connect.
- **Join a room** via `/room/<CODE>` — the link icon next to the room code opens a modal with
  the link, a QR code (scannable to join from a phone), and a one-click copy. New participants
  just pick a display name — no account needed. Each browser gets a stable
  per-room identity (`agility:client:<code>` in `localStorage`), so refreshing the page or
  reconnecting reactivates the same roster entry rather than joining as a new person.
- **Who's in the room**: the avatar cluster in the header shows who's currently connected;
  clicking it opens the full roster of everyone who has joined (unless they were kicked), headed
  by a "here / joined" count (e.g. "2 / 6 members here"). Anyone not currently connected ("Away")
  is grayed out rather than removed, and your own entry is pinned to the top and highlighted.
  Names longer than 30 characters are shortened there, with the full name on hover. Admins get a
  "⋮" menu next to each name for the actions below.
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
  Poll, Wheel, Plinko, Team Randomizer, or Anonymous Box) from the dropdown on the activity name, next to the
  room name; everyone in the room sees the same activity. Participants can open the dropdown to
  see the options, but they're disabled — only admins can switch.
  - **Planning Poker** — an admin sets the round's topic (up to 60 characters, with a live
    count), and the deck is admin-customizable (numbers, sizes, or short text options);
    votes are hidden until an admin reveals them, then shows each vote plus the average of
    numeric votes. An anonymous-voting toggle hides who voted what (names stay visible, values
    don't) and resets the round when flipped. Past rounds are kept as poker history (topic, votes,
    average), reachable from the "View past rounds" link under the cards and loaded only when you
    open it — anonymous rounds stay anonymous in history even if the toggle is switched off later.
    Admins change the deck from the "⋮" at the top of the card picker.
    History keeps the newest 50 rounds (each new one pushes out the oldest), and admins can delete
    single rounds or all of them from the history dialog. Poll history works the same way.
  - **Anonymous Box** — everyone, admins included, can submit free-text feedback (up to 2,000
    characters each, with a counter as you type) with no name attached, up to 500 submissions per
    room; only admins can see submitted messages (others just see a running submission count), and
    the list loads when an admin opens the Anonymous Box. Admins get the submission form above the
    list, and can delete single submissions or all of them (which also makes room once it's full).
    The form only says "sent" once the server has stored it.
  - **Plinko** — the showpiece picker, for special occasions. An admin enters up to 12 options —
    more would make the bins too narrow to label — and drops the ball: it bounces peg to peg down a staggered board, each
    peg flashing as it's hit, and settles into a bin, which lights up with confetti. It's "movie
    physics": the winner is picked uniformly at random first (every option has the same chance,
    unlike a real board, where middle bins win far more often), then a believable bounce path into
    that bin is generated, so everyone watches the identical drop. Admins pick a drop speed (Slow /
    Normal / Fast — roughly 6, 4 and 2½ seconds), which applies to everyone from the next drop.
    Late joiners see where it landed; "Remove <winner>" and reduced-motion work as for the Wheel.
  - **Team Randomizer** — an admin enters a list of names and a desired team count; "Generate teams"
    shuffles the names server-side and splits them round-robin into that many teams.
    Its names box, like the Wheel's and Plinko's options, has two shortcuts: "Use current room
    members" fills it with everyone connected, and "Clear" empties it. Both only change the box —
    nothing reaches the room until the admin saves (or generates).
  - **Wheel** — an admin enters up to 30 options (or pulls in the room's members) and spins a
    colorful wheel: it whips around several times and coasts to a stop, the pointer flicking as
    slices pass, then the winner is highlighted with a burst of confetti. The server decides the
    whole spin, so everyone sees the same animation land on the same winner; anyone who joins
    afterwards just sees where it landed. After a spin, "Remove <winner>" takes that option off
    the wheel so the next spin picks from who's left (handy for choosing standup order one by one).
    Changing the options clears the last result. Devices set to reduce motion skip straight to the
    result.
  - **Poll** — StrawPoll-style: an admin asks a question with 2–10 options and chooses whether
    people can pick more than one, and whether it's anonymous (only counts shown — the default) or
    named (voters listed under each option). Everyone votes and can change their vote until the
    admin closes the poll. Participants see the results only once they've voted (or the poll is
    closed), so early results don't sway them; admins see them live. Votes stay counted if the
    voter disconnects (unlike poker). Finished polls — closed, or replaced by a new poll while
    still open — are kept as poll history (question, final counts, and names for named polls),
    reachable from the "View past polls" link under the poll; reopening and re-closing a poll
    updates its entry. Polls
    nobody voted in aren't kept.

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
- **Behind a reverse proxy** (Caddy, a load balancer), set `TRUSTED_PROXY_HOPS` to how many of
  your own proxies sit in front of the server (e.g. `1` for Caddy alone). The room-creation limit
  (10 rooms per IP per day) is per client IP; without this, every request would appear to come
  from the proxy itself, and everyone would share one allowance. Leave it unset (0) when nothing
  is in front of the server: then `X-Forwarded-For` is ignored, since a client could fake it.
  The same IP is used for the 20-connections-per-IP limit (`MAX_CONNECTIONS_PER_IP` to change it).
- `GET /api/health` returns `{ status: "ok" }` for use as an ALB target group / ECS task health
  check.
- **Caveat for scaling to multiple instances**: switching to `DynamoRoomStore` solves the room-data
  half of this (any instance can read/write any room, and versioned writes stop two instances from
  overwriting each other's changes to the same room), but Socket.IO still needs a client to stay
  connected to the same instance it joined a room on — that half needs either sticky sessions
  (session affinity on the ALB) or a Socket.IO adapter (typically Redis) so broadcasts reach
  sockets connected to other instances. Not needed for a single instance.

## Notes / known limitations (fine for an MVP, worth revisiting before wider use)

- Unexpected server errors (e.g. DynamoDB failing even after the AWS SDK's retries) are logged and
  reported to the person who acted ("Something went wrong on our end — please try that again"),
  but not retried automatically. Two edge cases: if the write that marks someone as having left
  fails, they stay shown as connected until they next join or leave; and if the server can't be
  reached at all when the page loads, it stays on "Connecting…" while the browser keeps retrying
  the connection (the 10s join timeout starts once connected).
- **Server restarts (deploys)** disconnect everyone for a few seconds. Rooms live in DynamoDB, so
  nothing is lost: each open room shows a "Connection lost — reconnecting…" banner, goes read-only
  (so no click is silently dropped), and rejoins on its own when the server is back. People who
  closed their tab during the restart are marked Away about 30 seconds after their room is next
  used (the old server couldn't record them leaving). With in-memory storage, a restart still
  wipes every room.
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
- One tab per browser: opening a room in a new tab (the same room or another one) takes over,
  and the older tab disconnects and shows "Agility is open in another tab" with a "Use here"
  button to take it back. So a person is in one room at a time per browser — two with a private
  window, which can't see the regular window's tabs. It's coordinated between tabs in the browser
  (so it also keeps a browser's connections down); a script could still ignore it, which is what
  the per-IP connection limit is for.
- Room data is in-memory only by default — restarting the server clears all rooms unless
  `ROOM_STORE=dynamodb` is set (see above), in which case a `DynamoRoomStore` persists rooms in a
  real DynamoDB table instead.
- With DynamoDB, poker history rounds, poll history and feedback submissions expire 60 days after
  they were recorded, even if the room itself is still in use — a long-running room gradually
  drops its oldest entries. (The in-memory store keeps them for the life of the room.)
- **Limits that keep storage and cost bounded:** a room's roster holds 100 people (when full, a
  newcomer replaces the longest-gone Away non-admin entry; with none, joining is refused), the
  Anonymous Box holds 500 submissions, poker and poll history keep the newest 50 each, each client
  IP can create 10 rooms per rolling day, a single socket message can be at most 64 KB, each
  connection can send 10 messages a second (bursts of up to 20 are fine; past that, messages are
  dropped with a "slow down" notice), and each IP can hold 20 connections at once (a browser
  keeps just one, see above). These counters are kept in memory, so they reset when the server restarts and would
  be counted per instance if there were several.
- **Offices share an IP.** Everyone behind one office network or VPN usually shows up as a single
  IP, so 20 connections per IP could turn people away in a big in-office meeting. Raise it with the
  `MAX_CONNECTIONS_PER_IP` environment variable if that happens.

### Future considerations

- **A vote sent right after a Reset can be rejected.** Votes are written directly (one field, no
  queue), while Reset goes through the queued whole-room path. A vote that reaches DynamoDB before
  a Reset it was sent after still sees the round as revealed, so it's refused and the card just
  stays unselected. In practice the Reset lands in milliseconds — only a scripted client voting
  ~100ms after a Reset under heavy load hit it — but if it shows up for real users, the client
  could hold card clicks for a moment after a reset, or the server could briefly retry a vote
  refused only because the round was still revealed.
- **Scope the AWS access key down before deploying.** The IAM user behind the key in `.env.local`
  has a scoped inline policy for the two `agility-rooms-v2` tables (the actions listed under
  "DynamoDB table setup" above), but also still has broader DynamoDB access from another policy
  (likely `AmazonDynamoDBFullAccess`) — enough to read or delete any table in the account if the
  key leaked. To finish: remove the broad policy in IAM → Users → Permissions, then run
  `npm run test:dynamo` once; if it passes, the inline policy covers everything the app needs.
- **Mobile polish left over.** The layout works down to 320px wide, but on a phone the room name
  is cut short next to the activity name, and the roster's "⋮" buttons are 24px (below the
  ~44px usually recommended for touch). Left for when the room layout settles.
