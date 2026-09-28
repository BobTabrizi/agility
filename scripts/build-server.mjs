// Bundles the custom server (server.ts plus everything it imports from src/)
// into one plain-JavaScript file, dist/server.cjs, so production runs it with
// `node` instead of translating TypeScript on every start with tsx — which
// also means production doesn't need any dev tools installed. npm packages
// aren't bundled (`packages: "external"`); they're loaded from node_modules at
// runtime as usual. Development keeps using `tsx watch server.ts`.
//
// server.ts loads the socket server with a dynamic import() so .env.local is
// loaded first (see CLAUDE.md). esbuild keeps that lazy: a dynamically
// imported module in a bundle only runs when the import() does.
import { build } from "esbuild";

await build({
  entryPoints: ["server.ts"],
  outfile: "dist/server.cjs",
  bundle: true,
  platform: "node",
  // CommonJS, like tsx runs server.ts today (package.json has no "type").
  format: "cjs",
  target: "node24",
  packages: "external",
  // Stack traces point at the .ts sources (npm start runs node --enable-source-maps).
  sourcemap: true,
  logLevel: "info",
});
