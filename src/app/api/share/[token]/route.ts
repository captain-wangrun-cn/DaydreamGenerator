import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { formatBlobError, getBlobAuthOptions } from "@/lib/blob-config";
import { verifyShareToken } from "@/lib/share-token";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const secret = process.env.SHARE_SECRET;
    if (!secret) {
      throw new Error("直链签名密钥未配置：请设置 SHARE_SECRET。");
    }
    const blobAuth = getBlobAuthOptions();

    const { token } = await context.params;
    const payload = await verifyShareToken(token, secret);
    const result = await list({
      prefix: payload.pathname,
      limit: 1,
      ...blobAuth
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
        error: formatBlobError(error)
      },
      { status: 400 }
    );
  }
}
