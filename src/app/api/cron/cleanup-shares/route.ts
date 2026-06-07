import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { formatBlobError, getBlobAuthOptions } from "@/lib/blob-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET;
    if (expected) {
      const auth = request.headers.get("authorization");
      if (auth !== `Bearer ${expected}`) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
    }

    const blobAuth = getBlobAuthOptions();
    const result = await list({ prefix: "shares/", limit: 1000, ...blobAuth });
    const now = Date.now();
    const expired = result.blobs.filter((blob) => {
      const match = blob.pathname.match(/^shares\/(\d+)-/);
      return match ? Number(match[1]) <= now : false;
    });

    if (expired.length > 0) {
      await del(expired.map((blob) => blob.url), blobAuth);
    }

    return NextResponse.json({
      deleted: expired.length
    });
  } catch (error) {
    return NextResponse.json({ error: formatBlobError(error) }, { status: 400 });
  }
}
