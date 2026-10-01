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

To test from a phone or another device on your network (`http://<this machine's IP>:3000`), add
this machine's LAN IP to `allowedDevOrigins` in `next.config.ts` and restart the dev server.
Without it the dev server blocks its scripts for that address: the page shows, but nothing on it
works (buttons stay disabled, the join box doesn't uppercase). Development only.

`npm run build` builds the Next.js app and compiles the custom server into one plain-JavaScript
file, `dist/server.cjs` (bundled with esbuild — `scripts/build-server.mjs`); `npm start` runs that
with plain `node`, so production needs no TypeScript tooling. The server shuts down gracefully on
SIGTERM/SIGINT (what a deploy or Ctrl+C sends): it closes every client connection so browsers
start reconnecting straight away, stops accepting requests, and exits within 8 seconds.

`npm test` runs the test suite (Vitest) once; `npm run test:watch` runs it in watch mode. Neither
touches AWS: the DynamoDB tests run against a real (pay-per-request) table, so they're opt-in via
`npm run test:dynamo` — worth running after changing the room storage code, not on every edit.
With the Docker setup below running, `npm run test:dynamo:local` runs the same tests against
DynamoDB Local instead — free, and no AWS account needed.

### With Docker (no AWS needed)

```bash
docker compose up --build
```

builds the production image and runs it at [http://localhost:3000](http://localhost:3000) with
`ROOM_STORE=dynamodb` against **DynamoDB Local** (Amazon's offline copy of DynamoDB, in its own
container) — the same code path as the deployed app, with nothing billed. `docker-compose.yml`
starts three services: `dynamodb`, `tables` (creates the tables with
`scripts/create-local-tables.mjs`, then exits) and `app`. The AWS SDK reads
`AWS_ENDPOINT_URL_DYNAMODB` on its own, so pointing at DynamoDB Local needs no app setting; the
credentials in the compose file are dummies (DynamoDB Local accepts any). Its data is in memory:
it survives `docker compose restart app` (handy for testing reconnects and the graceful shutdown)
but not `docker compose down`.

## CI

**GitHub Actions** (`.github/workflows/ci.yml`) runs on every push to `main` and every pull
request: lint, type-check, `npm test`, the DynamoDB suite against DynamoDB Local (a service
container — `npm run test:dynamo:local`, never real AWS), `npm run build`, and a build of the
Docker image (not pushed anywhere). It uses no secrets, and the repo is public, so the minutes
are free. Nothing deploys automatically yet.

**Jenkins** can be used as an alternative (`ci/jenkins/`): the `Jenkinsfile` at the repo root
runs the same checks, each step in a throwaway container on Docker Desktop.

1. Start it: `docker compose up -d --build` in `ci/jenkins/`, then open
   [http://localhost:8080](http://localhost:8080) (only reachable from this machine).
2. Unlock it with the initial admin password:
   `docker exec jenkins-jenkins-1 cat /var/jenkins_home/secrets/initialAdminPassword` (or open
   the container's logs in Docker Desktop, where it's printed between rows of asterisks). In Git
   Bash, write `//var/...`: it rewrites a leading `/var` into a Windows path otherwise. Then "Install suggested plugins" (the ones the `Jenkinsfile` needs are
   already in the image) and create your admin user.
3. New Item → name it → **Pipeline** → under Pipeline, Definition **Pipeline script from SCM**,
   SCM **Git**, the repo's GitHub URL, branch `*/main`, script path `Jenkinsfile` → Save →
   **Build Now**. Jenkins reads the `Jenkinsfile` from GitHub, so it builds what's been pushed,
   not local changes.
4. A Jenkins on localhost can't receive GitHub's webhooks; to build on new commits, tick
   **Poll SCM** under Triggers with a schedule like `H/5 * * * *`.

Its jobs and history live in the `jenkins_home` Docker volume (`docker compose down -v` wipes
them).

**Disk space.** Everything Docker stores — images, containers, volumes, build cache — lives in one
file, `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` (~10 GB with this setup). Of that:
- **Jenkins** is about 250 MB of plugins and Jenkins itself, plus build logs (tiny: the
  `Jenkinsfile` keeps the last 20 builds per job). The `Jenkinsfile` deletes each build's
  workspace when it finishes (`cleanWs`) — otherwise every job, and every branch and pull request
  of a multibranch job, would keep ~700 MB of `node_modules` and `.next` around.
- **Images** are about 3 GB: the ones builds use (`node:24-alpine`, `amazon/dynamodb-local`,
  `agility:jenkins` — overwritten by each build, so it doesn't pile up), Jenkins's own, and the
  compose app's `agility:local`.
- **Docker's build cache** is what keeps growing, with every image build. Clear it now and then
  with `docker builder prune -f`, and unused images with `docker image prune -f`.

`docker system df` shows the breakdown. Freed space is reused, but the `.vhdx` file itself never
shrinks: to hand space back to Windows, use Docker Desktop → Troubleshoot → Clean / Purge data
(wipes everything, Jenkins included), or stop Docker and compact the file with `Optimize-VHD`
from an admin PowerShell. It has full control of Docker through the mounted socket — fine on your own machine, never
something to expose to a network.

## How rooms work

- **Create a room** on the home page: enter your display name and, optionally, a room name.
  The server generates a 6-character room code and an admin token; the token is stored in
  `localStorage` on your device only (`agility:admin:<code>`) and is what marks you as admin when
  you connect.
- **Join a room** via `/room/<CODE>`, or by typing the 6-character code into the home page's join
  box (pasting a whole invite link works too). Clicking the link icon next to the room code
  copies the invite link straight away ("Invite link copied to clipboard") and opens a dialog with
  the link, a QR code (scannable to join from a phone) and a Copy button. New participants
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
- **Leaving**: everyone has a Leave button (a door icon, "Leave room" on hover) next to their own
  name in the member list. After a confirmation it removes you from the roster (rather than
  leaving you listed as Away, which is what closing the tab does) and takes you back to the home
  page. An appointed admin gives up
  admin by leaving; the room's creator stays an admin, since that comes from their browser. Poll
  votes you already cast still count. You can rejoin any time with the invite link.
- **Activities**: an admin picks which activity is active for the whole room (Planning Poker,
  Poll, Wheel, Plinko, Team Randomizer, or Anonymous Box) from the dropdown on the activity name, next to the
  room name; everyone in the room sees the same activity. Participants can open the dropdown to
  see the options, but they're disabled — only admins can switch.
  - **Planning Poker** — an admin sets the round's topic (up to 60 characters, with a live
    count), and the deck is admin-customizable (numbers, sizes, or short text options; rooms start with the
    Simple deck, 1 2 3 5 8 13 ?, and Fibonacci, T-shirt sizes and others are one-click presets);
    votes are hidden until an admin reveals them. The reveal groups people by what they voted —
    one row per value, low to high, with a colored badge (matching the pie chart below it), how
    many chose it, who, and a "Most votes" marker — plus anyone who didn't vote, and the average
    of numeric votes. An anonymous-voting toggle hides who voted what (the rows then show only
    counts) and resets the round when flipped — after a confirmation if there are votes or
    results on screen to lose. Past rounds are kept as poker history (topic, votes,
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

## Deploying (AWS)

The trial deployment is one small EC2 instance — no Docker — with Caddy in front for HTTPS:

```
browser ──HTTPS──▶ Caddy (:443, auto certificate) ──▶ node dist/server.cjs (127.0.0.1:3000) ──▶ DynamoDB
                                                       run by systemd, AWS access via instance role
```

**One-time setup** (region: the table's, e.g. `us-west-1`):

1. **IAM role** `agility-ec2` (trusted entity: EC2) with an inline policy allowing `GetItem`,
   `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchWriteItem` and `ConditionCheckItem` on
   the production table's ARN only. The server gets AWS access from this role — no access key
   on the machine.
2. **EC2 instance**: Ubuntu 24.04 (Arm), `t4g.micro` (1 GB is plenty to *run*: ~160 MB), the
   role above as its instance profile, and a security group allowing SSH (22) from your IP only
   and HTTP/HTTPS (80/443) from anywhere — never port 3000. Attach an **Elastic IP** so the
   address survives stop/start.
3. **Domain**: an `A` record pointing at the Elastic IP (a free DuckDNS subdomain works — set
   its IP by hand to the Elastic IP; its update scripts aren't needed with a fixed IP).
4. **Node 24** on the instance (NodeSource's `setup_24.x`, then `apt-get install nodejs`), and an
   app folder `/opt/agility` owned by `ubuntu`.
5. **`/etc/agility.env`** (root-only, `chmod 600`; `.env.local` is never copied):
   ```
   NODE_ENV=production
   PORT=3000
   HOST=127.0.0.1
   ROOM_STORE=dynamodb
   DYNAMODB_TABLE_NAME=agility-rooms-v2
   AWS_REGION=us-west-1
   TRUSTED_PROXY_HOPS=1
   CORS_ORIGIN=https://your-domain.example
   ```
   `HOST=127.0.0.1` keeps the app reachable only through Caddy. `CORS_ORIGIN` is the site's own
   address (scheme + domain, no path), so only its pages can open real-time connections.
6. **`/etc/systemd/system/agility.service`**, then `sudo systemctl daemon-reload && sudo systemctl
   enable --now agility`:
   ```
   [Unit]
   Description=Agility
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=ubuntu
   WorkingDirectory=/opt/agility
   EnvironmentFile=/etc/agility.env
   ExecStart=/usr/bin/node --enable-source-maps dist/server.cjs
   Restart=always
   RestartSec=3
   TimeoutStopSec=15

   [Install]
   WantedBy=multi-user.target
   ```
   It runs `node` directly (not `npm start`) so systemd's stop signal reaches the app and the
   graceful shutdown runs; it restarts the app if it crashes and on reboot.
7. **Caddy** from its official apt repository, with `/etc/caddy/Caddyfile`:
   ```
   your-domain.example {
       reverse_proxy 127.0.0.1:3000
   }
   ```
   then `sudo systemctl reload caddy`. Caddy gets and renews the certificate, redirects HTTP to
   HTTPS, proxies WebSockets, and appends the client IP to `X-Forwarded-For` (hence
   `TRUSTED_PROXY_HOPS=1`). It needs the DNS record in place and ports 80/443 open first.

**Each release** — build locally (`next build` wants most of 1 GB, so don't build on the micro):

```bash
npm run build
tar -czf agility-release.tgz --exclude=.next/cache --exclude=.next/dev .next dist public package.json package-lock.json next.config.ts
scp -i <key.pem> agility-release.tgz ubuntu@<your-domain>:/opt/agility/
```

then on the server: `cd /opt/agility && tar -xzf agility-release.tgz && npm ci --omit=dev &&
sudo systemctl restart agility` (the package is ~3 MB; `npm ci --omit=dev` installs no build
tools). Everyone sees the "reconnecting" banner for a few seconds and rejoins on their own.

**Checking on it**: `https://<your-domain>/api/health/ready` should return 200 with
`"database":"ok"`; on the server, `systemctl status agility`, `journalctl -u agility -f` (app log)
and `journalctl -u caddy -n 50` (certificates). Cost guards, set in the AWS console: a Budgets
alarm, the table's on-demand maximum throughput, TTL on `expiresAt`, and Cost Anomaly Detection.

Other deployment notes:

- A `Dockerfile` at the repo root builds the production image (`docker build -t agility .` /
  `docker run -p 3000:3000 agility`, in-memory rooms unless you pass the DynamoDB settings with
  `-e`). Two stages: the first installs everything and runs `npm run build`; the final image has
  only production packages plus `.next/`, `dist/` and `public/`, runs as the unprivileged `node`
  user, and starts with `node dist/server.cjs` directly, so `docker stop`'s SIGTERM reaches the
  app and the graceful shutdown runs (a restart takes under a second instead of Docker's 10s
  kill). It also deletes the glibc builds of Next's compiler and sharp that npm installs
  alongside Alpine's musl ones (~110 MB that could never load). Verified with
  `docker compose` (rooms, votes, health checks, restart). Note that Docker's `HEALTHCHECK` only
  marks a container unhealthy; plain Docker doesn't restart it (ECS does; on a single host, use
  systemd or an autoheal helper).
- The server binds to `0.0.0.0` (not `localhost`), so it's reachable from outside the container.
- **Behind a reverse proxy** (Caddy, a load balancer), set `TRUSTED_PROXY_HOPS` to how many of
  your own proxies sit in front of the server (e.g. `1` for Caddy alone). The room-creation limit
  (10 rooms per IP per day) is per client IP; without this, every request would appear to come
  from the proxy itself, and everyone would share one allowance. Leave it unset (0) when nothing
  is in front of the server: then `X-Forwarded-For` is ignored, since a client could fake it.
  The same IP is used for the 20-connections-per-IP limit (`MAX_CONNECTIONS_PER_IP` to change it).
- **`CORS_ORIGIN`**: the origins allowed to open real-time connections, comma-separated (e.g.
  `https://agility.example`). Every Socket.IO connection's `Origin` header is checked against it,
  WebSocket included (CORS itself doesn't apply to WebSockets), so another website can't connect
  to the server from its visitors' browsers; those get a 403. Requests with no `Origin` (not
  from a browser page) are let through — they could claim any origin anyway. Unset (local dev,
  Docker compose, CI), any origin is allowed, exactly as before.
- Two health endpoints, both uncacheable, `200` when healthy and `503` when not:
  - `GET /api/health` (**liveness**): the server is up and Socket.IO is attached. For whatever
    restarts the server (the `Dockerfile`'s `HEALTHCHECK` uses it). It deliberately never checks
    the database, since restarting over a DynamoDB hiccup would only disconnect everyone.
  - `GET /api/health/ready` (**readiness**): the above plus one tiny DynamoDB read, within 3s.
    Point an uptime monitor (e.g. UptimeRobot, Route 53 health checks) here, to alert rather than
    restart. Checked once a minute that's about 43k small reads a month, a fraction of a cent.

  Both return only which check failed (e.g. `{"status":"error","checks":{"realtime":"ok","database":"failed"}}`);
  the actual error is in the server log as `[health] database check failed …`.
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
- Roster entries are only removed when an admin kicks them, when someone leaves with the Leave
  button, or when a full room (100) makes space for a newcomer — closing the tab just marks you
  Away, so in a long-lived room with lots of churn the list grows until an admin tidies it up.
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

- **Logs and uptime monitoring.** On the EC2 deployment the app's output (errors, failed health
  checks as `[health] …`) goes to the systemd journal (`journalctl -u agility`), which only lives
  on the instance. Ship it to CloudWatch Logs (the CloudWatch agent) so it's searchable from the
  console and survives the instance, and point a free uptime monitor at `/api/health/ready`.
- **A vote sent right after a Reset can be rejected.** Votes are written directly (one field, no
  queue), while Reset goes through the queued whole-room path. A vote that reaches DynamoDB before
  a Reset it was sent after still sees the round as revealed, so it's refused and the card just
  stays unselected. In practice the Reset lands in milliseconds — only a scripted client voting
  ~100ms after a Reset under heavy load hit it — but if it shows up for real users, the client
  could hold card clicks for a moment after a reset, or the server could briefly retry a vote
  refused only because the round was still revealed.
- **Scope down the local AWS access key.** The deployed server doesn't use it (it has the
  `agility-ec2` instance role, scoped to the one table). But the IAM user behind the key in
  `.env.local` — used for local development and `npm run test:dynamo` — has a scoped inline policy
  for the two tables *and* broader DynamoDB access from another policy (likely
  `AmazonDynamoDBFullAccess`), enough to read or delete any table in the account if the key
  leaked. To finish: remove the broad policy in IAM → Users → Permissions, then run
  `npm run test:dynamo` once; if it passes, the inline policy covers everything the app needs.
- **Mobile polish left over.** The layout works down to 320px wide, but on a phone the room name
  is cut short next to the activity name, and the roster's "⋮" buttons are 24px (below the
  ~44px usually recommended for touch). Left for when the room layout settles.
