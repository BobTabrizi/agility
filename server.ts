import { createServer } from "http";
import next from "next";
import { CLIENT_IP_HEADER, clientIp } from "./src/server/clientIp";

const dev = process.env.NODE_ENV !== "production";
// Bind to all interfaces by default so this works unchanged inside a container
// (binding to "localhost" there would make the server unreachable from outside).
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

// How long a graceful shutdown may take before the process exits anyway —
// under the 10s or more that Docker/ECS/systemd allow before force-killing.
const SHUTDOWN_TIMEOUT_MS = 8_000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Dynamic, not a static top-level import: a static import's whole chain —
  // including roomStore.ts reading process.env.ROOM_STORE at module-load
  // time — would evaluate before `next({...})` above even runs, seeing an
  // empty environment. `next({...})` loads .env.local synchronously in its
  // own constructor, so anything importing roomStore.ts (directly or
  // transitively) must come after this line.
  const { initSocketServer, closeSocketServer } = await import("./src/server/socketServer");

  // Next parses the URL itself (passing a url.parse() result is the old,
  // deprecated pattern — Node warns about url.parse()).
  const httpServer = createServer((req, res) => {
    // The client's IP for per-IP limits (see clientIp.ts). Always overwritten,
    // so a client can't set it themselves. (Socket.IO's own requests don't
    // come through here; socketServer.ts works out their IP the same way.)
    req.headers[CLIENT_IP_HEADER] = clientIp(req.headers, req.socket.remoteAddress);
    return handle(req, res);
  });

  initSocketServer(httpServer);

  httpServer.listen(port, () => {
    console.log(`> Agility ready on http://localhost:${port}`);
  });

  // Graceful shutdown. A deploy (Docker, systemd, ECS) stops the old process
  // with SIGTERM; Ctrl+C sends SIGINT. Close the socket server and HTTP server
  // (see closeSocketServer) and exit, with a deadline in case something hangs.
  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`> ${signal} received, shutting down`);
    setTimeout(() => {
      console.error("> Shutdown took too long, exiting anyway");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    await closeSocketServer();
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
});
