import { describe, expect, it } from "vitest";
import { buildProviderPayload, enforceInterviewBeforeSubmit, makeLocalDraft } from "@/lib/llm/providers";
import { buildEditUserPrompt, buildUserPrompt, editorSystemPrompt } from "@/lib/llm/prompt";
import { openAiEditorTools } from "@/lib/llm/tools";
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

describe("AI edit mode", () => {
  const testCard = normalizeCard({
    name: "星港店主",
    description: "会在凌晨开门的旧星港店主。",
    personality: "沉默寡言，偶尔露出温柔的眼神。"
  }, "character");

  it("allows card submission when skipInterview is true without any answers", () => {
    const result = enforceInterviewBeforeSubmit({
      action: "submit_card",
      status: "draft",
      card: testCard
    }, {
      ...baseRequest,
      skipInterview: true,
      currentCard: testCard
    });

    expect(result.action).toBe("submit_card");
  });

  it("editorSystemPrompt does not contain ask_user restrictions", () => {
    const prompt = editorSystemPrompt();
    expect(prompt).not.toContain("至少一轮 ask_user");
    expect(prompt).not.toContain("先 ask_user 再 submit_card");
    expect(prompt).toContain("编辑");
    expect(prompt).toContain("submit_card");
  });

  it("buildEditUserPrompt includes card JSON and instruction", () => {
    const prompt = buildEditUserPrompt({
      currentCard: testCard,
      prompt: "把性格改成更冷酷",
      language: "zh-CN",
      messages: []
    });

    expect(prompt).toContain("星港店主");
    expect(prompt).toContain("把性格改成更冷酷");
    expect(prompt).toContain("submit_card");
  });

  it("openAiEditorTools excludes ask_user", () => {
    const tools = openAiEditorTools();
    const toolNames = tools.map((tool) => tool.function.name);
    expect(toolNames).toContain("submit_card");
    expect(toolNames).toContain("web_search");
    expect(toolNames).not.toContain("ask_user");
  });

  it("buildProviderPayload uses editor prompt when skipInterview is true", () => {
    const payload = buildProviderPayload({
      ...baseRequest,
      prompt: "把性格改成更冷酷",
      currentCard: testCard,
      skipInterview: true
    });

    const body = JSON.parse(payload.init.body as string);
    const systemMessage = body.messages?.[0]?.content;
    expect(systemMessage).toBeDefined();
    expect(systemMessage).toContain("编辑");
    expect(systemMessage).not.toContain("至少一轮 ask_user");
  });
});
