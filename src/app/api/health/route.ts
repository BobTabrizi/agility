import { NextResponse } from "next/server";

// Used by load balancer / container health checks (e.g. an ECS target group).
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
