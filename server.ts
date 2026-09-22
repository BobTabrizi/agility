import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketServer } from "./src/server/socketServer";

const dev = process.env.NODE_ENV !== "production";
// Bind to all interfaces by default so this works unchanged inside a container
// (binding to "localhost" there would make the server unreachable from outside).
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url || "", true);
    handle(req, res, parsedUrl);
  });

  initSocketServer(httpServer);

  httpServer.listen(port, () => {
    console.log(`> Agility ready on http://localhost:${port}`);
  });
});
