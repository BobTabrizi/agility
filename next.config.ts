import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server be reached from other devices on the LAN (e.g.
  // testing from a phone at http://<this machine's IP>:3000). Without this,
  // `next dev` blocks cross-origin requests to dev assets/HMR by default, the
  // page loads but never hydrates, and clicks fall back to a full-page form
  // submit — which looks like "nothing happens and the input clears". Dev-only;
  // has no effect on `next build`/production. Add more IPs here if this
  // machine's LAN address changes or you test from another network.
  allowedDevOrigins: [""],
};

export default nextConfig;
