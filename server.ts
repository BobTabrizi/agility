import { createServer } from "http";
import { parse } from "url";
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

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url || "", true);
    handle(req, res, parsedUrl);
  });

  initSocketServer(httpServer);

  httpServer.listen(port, () => {
    console.log(`> Agility ready on http://localhost:${port}`);
  });
});
