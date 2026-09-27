import { createServer } from "http";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
// Bind to all interfaces by default so this works unchanged inside a container
// (binding to "localhost" there would make the server unreachable from outside).
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Dynamic, not a static top-level import: a static import's whole chain —
  // including roomStore.ts reading process.env.ROOM_STORE at module-load
  // time — would evaluate before `next({...})` above even runs, seeing an
  // empty environment. `next({...})` loads .env.local synchronously in its
  // own constructor, so anything importing roomStore.ts (directly or
  // transitively) must come after this line.
  const { initSocketServer } = await import("./src/server/socketServer");

  // Next parses the URL itself (passing a url.parse() result is the old,
  // deprecated pattern — Node warns about url.parse()).
  const httpServer = createServer((req, res) => handle(req, res));

  initSocketServer(httpServer);

  httpServer.listen(port, () => {
    console.log(`> Agility ready on http://localhost:${port}`);
  });
});
