import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { characterCardV2Schema } from "@/lib/card-schema";
import { dataUrlToBase64, dataUrlToMime, SHARE_MAX_BYTES } from "@/lib/media";
import { embedCardInPngDataUrl } from "@/lib/png-card";
import { signShareToken } from "@/lib/share-token";

export const runtime = "nodejs";

const expirationSchema = z.enum(["1h", "24h", "7d"]);

const requestSchema = z.object({
  card: characterCardV2Schema,
  avatarDataUrl: z.string().optional(),
  expiresIn: expirationSchema.default("24h")
});

const expirationMs: Record<z.infer<typeof expirationSchema>, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000
};

export async function POST(request: Request) {
  try {
    const secret = process.env.SHARE_SECRET;
    if (!secret) {
      throw new Error("Missing SHARE_SECRET.");
    }

    const body = requestSchema.parse(await request.json());
    const expiresAt = Date.now() + expirationMs[body.expiresIn];
    const safeName = sanitizeFilename(body.card.data.name || "card");
    const hasAvatar = Boolean(body.avatarDataUrl);
    const contentType = hasAvatar ? "image/png" : "application/json";
    const filename = `${safeName}.${hasAvatar ? "png" : "json"}`;
    const pathname = `shares/${expiresAt}-${crypto.randomUUID()}-${filename}`;

    let blobBody: string | Buffer;

    if (hasAvatar && body.avatarDataUrl) {
      if (dataUrlToMime(body.avatarDataUrl) !== "image/png") {
        throw new Error("PNG 直链需要 PNG 头像图片。");
      }
      const png = embedCardInPngDataUrl(body.avatarDataUrl, body.card);
      blobBody = Buffer.from(dataUrlToBase64(png), "base64");
    } else {
      blobBody = JSON.stringify(body.card, null, 2);
    }

    const byteLength = typeof blobBody === "string"
      ? Buffer.byteLength(blobBody)
      : blobBody.byteLength;

    if (byteLength > SHARE_MAX_BYTES) {
      throw new Error("Shared file is too large.");
    }

    await put(pathname, blobBody, {
      access: "public",
      contentType
    });

    const token = await signShareToken({
      pathname,
      filename,
      contentType,
      expiresAt
    }, secret);

    return NextResponse.json({
      url: new URL(`/api/share/${token}`, request.url).toString(),
      expiresAt,
      filename,
      contentType
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown share error."
      },
      { status: 400 }
    );
  }
}

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "card";
}
