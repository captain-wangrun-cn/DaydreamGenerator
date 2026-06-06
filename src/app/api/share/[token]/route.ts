import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { verifyShareToken } from "@/lib/share-token";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const secret = process.env.SHARE_SECRET;
    if (!secret) {
      throw new Error("Missing SHARE_SECRET.");
    }

    const { token } = await context.params;
    const payload = await verifyShareToken(token, secret);
    const result = await list({
      prefix: payload.pathname,
      limit: 1
    });
    const blob = result.blobs.find((item) => item.pathname === payload.pathname);

    if (!blob) {
      return NextResponse.json({ error: "Shared file not found." }, { status: 404 });
    }

    const blobResponse = await fetch(blob.url);
    if (!blobResponse.ok || !blobResponse.body) {
      return NextResponse.json({ error: "Could not read shared file." }, { status: 502 });
    }

    return new Response(blobResponse.body, {
      headers: {
        "Content-Type": payload.contentType,
        "Content-Disposition": `attachment; filename="${payload.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ExpiredShareToken") {
      return NextResponse.json({ error: "Share link expired." }, { status: 410 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown share error."
      },
      { status: 400 }
    );
  }
}
