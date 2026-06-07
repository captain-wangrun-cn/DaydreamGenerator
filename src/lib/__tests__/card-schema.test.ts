import { describe, expect, it } from "vitest";
import { isShareableCard, normalizeCard } from "@/lib/card-schema";

describe("Character Card V2 schema", () => {
  it("normalizes data-only character drafts into V2 cards", () => {
    const card = normalizeCard({
      name: "星港店主",
      description: "会在凌晨开门的旧星港店主。",
      tags: ["merchant", "merchant", ""]
    }, "character");

    expect(card.spec).toBe("chara_card_v2");
    expect(card.spec_version).toBe("2.0");
    expect(card.data.name).toBe("星港店主");
    expect(card.data.tags).toEqual(["merchant"]);
    expect(card.data.extensions.daydreamgenerator).toEqual({
      source: "daydream-generator",
      format: "character-card-v2"
    });
  });

  it("does not add a scene-specific branch", () => {
    const card = normalizeCard({
      name: "雨夜车站"
    }, "character");

    expect(card.data.tags).not.toContain("scene");
    expect(card.data.extensions.daydreamgenerator).toEqual({
      source: "daydream-generator",
      format: "character-card-v2"
    });
  });

  it("requires real generated content before a card is shareable", () => {
    expect(isShareableCard(normalizeCard({ name: "未命名角色" }, "character"))).toBe(false);
    expect(isShareableCard(normalizeCard({ name: "星港店主" }, "character"))).toBe(false);
    expect(isShareableCard(normalizeCard({
      name: "星港店主",
      description: "会在凌晨开门的旧星港店主。"
    }, "character"))).toBe(true);
  });
});
