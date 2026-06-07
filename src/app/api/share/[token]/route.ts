import { get } from "@vercel/blob";
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
    const blob = await get(payload.pathname, {
      access: "private",
      useCache: false,
      ...blobAuth
    });

    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: "Shared file not found." }, { status: 404 });
    }

    return new Response(blob.stream, {
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
