import { NextRequest, NextResponse } from "next/server";
import { roomStore } from "@/server/roomStore";
import { MAX_ROOMS_PER_IP_PER_DAY, roomCreationLimiter } from "@/server/rateLimit";
import { CLIENT_IP_HEADER } from "@/server/clientIp";
import { MAX_ROOM_NAME_LENGTH, type CreateRoomResponse } from "@/lib/types";

export async function POST(req: NextRequest) {
  // Set by server.ts from the connection (or our own proxy), never by the client.
  const ip = req.headers.get(CLIENT_IP_HEADER) ?? "unknown";
  if (!roomCreationLimiter.allowed(ip)) {
    return NextResponse.json(
      { error: `You've created ${MAX_ROOMS_PER_IP_PER_DAY} rooms in the last day — please try again later.` },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  // Trimmed before truncating so leading whitespace doesn't use up the limit.
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, MAX_ROOM_NAME_LENGTH) : "";

  const room = await roomStore.createRoom(name);
  // Only rooms actually created count toward the limit.
  roomCreationLimiter.record(ip);
  const response: CreateRoomResponse = { code: room.code, adminToken: room.adminToken };
  return NextResponse.json(response);
}
