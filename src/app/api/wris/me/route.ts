// GET /api/wris/me — 返回当前 wris.me 登录用户（服务端本地验签，不请求认证服务）
import { NextResponse } from "next/server";
import { getWrisUser } from "@/lib/wris-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = getWrisUser(request.headers.get("cookie"));
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
