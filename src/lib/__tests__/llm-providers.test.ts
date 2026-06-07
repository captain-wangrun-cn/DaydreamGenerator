import { describe, expect, it } from "vitest";
import { enforceInterviewBeforeSubmit, makeLocalDraft } from "@/lib/llm/providers";
import { buildUserPrompt } from "@/lib/llm/prompt";
import type { LlmTurnRequest } from "@/lib/llm/types";
import { normalizeCard } from "@/lib/card-schema";

const baseRequest: LlmTurnRequest = {
  config: {
    provider: "openai",
    apiKey: "test",
    model: "test"
  },
  kind: "character",
  prompt: "做一个星港店主",
  answers: "",
  messages: [],
  media: []
};

describe("LLM provider guardrails", () => {
  it("blocks direct card submission before an interview answer exists", () => {
    const result = enforceInterviewBeforeSubmit({
      action: "submit_card",
      status: "draft",
      card: normalizeCard({
        name: "星港店主",
        description: "会在凌晨开门的旧星港店主。"
      }, "character")
    }, baseRequest);

    expect(result.action).toBe("ask_user");
    if (result.action === "ask_user") {
      expect(result.questions[0]?.options).toHaveLength(3);
    }
  });

  it("allows card submission after interview answers exist", () => {
    const result = enforceInterviewBeforeSubmit({
      action: "submit_card",
      status: "draft",
      card: normalizeCard({
        name: "星港店主",
        description: "会在凌晨开门的旧星港店主。"
      }, "character")
    }, {
      ...baseRequest,
      answers: "1. 关系张力\n回答：日常相遇"
    });

    expect(result.action).toBe("submit_card");
  });

  it("passes the selected first-message language into the user prompt", () => {
    const prompt = buildUserPrompt({
      ...baseRequest,
      language: "en-US"
    });

    expect(prompt).toContain("English");
    expect(prompt).toContain("first_mes");
  });

  it("uses selected language for local draft first message", () => {
    const result = makeLocalDraft({
      kind: "character",
      prompt: "星港店主",
      answers: "",
      language: "ja-JP"
    });

    expect(result.action).toBe("submit_card");
    if (result.action === "submit_card") {
      expect(result.card.data.first_mes).toBe("こんにちは、ずっとあなたを待っていました。");
    }
  });
});
