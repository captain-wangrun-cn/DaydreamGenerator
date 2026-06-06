import { describe, expect, it } from "vitest";
import { normalizeCard } from "@/lib/card-schema";
import { embedCardInPngBytes, extractCardFromPngBytes } from "@/lib/png-card";

const onePixelPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
));

describe("PNG card metadata", () => {
  it("embeds and extracts chara metadata", () => {
    const card = normalizeCard({ name: "灯塔守夜人" }, "character");
    const embedded = embedCardInPngBytes(onePixelPng, card);
    const extracted = extractCardFromPngBytes(embedded);

    expect(extracted?.data.name).toBe("灯塔守夜人");
    expect(embedded.length).toBeGreaterThan(onePixelPng.length);
  });
});
