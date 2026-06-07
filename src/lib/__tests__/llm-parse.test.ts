import { describe, expect, it } from "vitest";
import { parseFallbackJson, parseToolResult } from "@/lib/llm/parse";

describe("LLM result parsing", () => {
  it("parses fallback ask_user JSON", () => {
    const result = parseFallbackJson('{"action":"ask_user","questions":[{"question":"你想要什么关系？","options":[{"label":"暧昧"},{"label":"敌对"}]}]}', "character");

    expect(result.action).toBe("ask_user");
    if (result.action === "ask_user") {
      expect(result.questions[0]?.question).toBe("你想要什么关系？");
      expect(result.questions[0]?.options.map((option) => option.label)).toEqual(["暧昧", "敌对", "保持原设定"]);
    }
  });

  it("fills options for string-only questions", () => {
    const result = parseFallbackJson('{"action":"ask_user","questions":["你想要什么关系？"]}', "character");

    expect(result.action).toBe("ask_user");
    if (result.action === "ask_user") {
      expect(result.questions[0]?.question).toBe("你想要什么关系？");
      expect(result.questions[0]?.options.map((option) => option.label)).toEqual(["保持原设定", "更柔和", "更强张力"]);
    }
  });

  it("parses tool submit_card arguments", () => {
    const result = parseToolResult("submit_card", {
      status: "final",
      thinking: "根据用户强调的海边意象，把角色核心放在漂泊感。",
      card: {
        data: {
          name: "海边旅人"
        }
      }
    }, "character");

    expect(result?.action).toBe("submit_card");
    if (result?.action === "submit_card") {
      expect(result.card.data.name).toBe("海边旅人");
      expect(result.thinking).toContain("海边意象");
    }
  });

  it("extracts collapsible thinking from fallback think blocks", () => {
    const result = parseFallbackJson('<think>先确认关系张力。</think>{"action":"ask_user","questions":["你想要什么关系？"]}', "character");

    expect(result.action).toBe("ask_user");
    if (result.action === "ask_user") {
      expect(result.thinking).toBe("先确认关系张力。");
    }
  });
});
