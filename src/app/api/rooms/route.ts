import { NextRequest, NextResponse } from "next/server";
import { roomStore } from "@/server/roomStore";
import type { CreateRoomResponse } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name : "";

  const room = await roomStore.createRoom(name);
  const response: CreateRoomResponse = { code: room.code, adminToken: room.adminToken };
  return NextResponse.json(response);
}
