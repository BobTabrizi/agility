"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | undefined;

/** Lazily creates a single shared socket connection for the browser tab. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/api/socket", autoConnect: true });
  }
  return socket;
}
