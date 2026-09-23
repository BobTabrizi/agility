import path from "node:path";
import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

// Unlike the Next.js app (server.ts), Vitest has no built-in .env.local
// loading — without this, DYNAMODB_TEST_TABLE etc. are never set and
// dynamoRoomStore.test.ts silently skips even when .env.local has them.
// No-ops safely if .env.local doesn't exist (the common case for anyone
// without AWS set up).
loadEnv({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
