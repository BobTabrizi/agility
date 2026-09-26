import { NextRequest, NextResponse } from "next/server";
import { roomStore } from "@/server/roomStore";
import { MAX_ROOM_NAME_LENGTH, type CreateRoomResponse } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  // Trimmed before truncating so leading whitespace doesn't use up the limit.
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, MAX_ROOM_NAME_LENGTH) : "";

  const room = await roomStore.createRoom(name);
  const response: CreateRoomResponse = { code: room.code, adminToken: room.adminToken };
  return NextResponse.json(response);
}
