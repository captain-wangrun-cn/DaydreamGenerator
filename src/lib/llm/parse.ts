import { normalizeCard, type CardKind } from "@/lib/card-schema";
import type { AskQuestion, LlmTurnOrSearchResult, LlmTurnResult } from "@/lib/llm/types";

export function parseFallbackJson(text: string, kind: CardKind): LlmTurnOrSearchResult {
  const thinkingFromText = extractThinkingFromText(text);
  const parsed = parseLooseJson(stripThinkingBlocks(text));

  if (parsed.action === "web_search" && typeof parsed.query === "string") {
    return {
      action: "web_search",
      query: parsed.query.trim()
    };
  }

  if (parsed.action === "ask_user") {
    return {
      action: "ask_user",
      message: typeof parsed.message === "string" ? parsed.message : undefined,
      thinking: normalizeThinking(parsed.thinking) ?? thinkingFromText,
      questions: normalizeQuestions(parsed.questions)
    };
  }

  if (parsed.action === "submit_card") {
    return {
      action: "submit_card",
      message: typeof parsed.message === "string" ? parsed.message : undefined,
      thinking: normalizeThinking(parsed.thinking) ?? thinkingFromText,
      status: parsed.status === "final" ? "final" : "draft",
      card: normalizeCard(parsed.card, kind)
    };
  }

  throw new Error("LLM response did not contain a supported action.");
}

export function parseToolResult(name: string, args: unknown, kind: CardKind): LlmTurnOrSearchResult | null {
  if (name === "web_search" && isRecord(args) && typeof args.query === "string") {
    return {
      action: "web_search",
      query: args.query.trim()
    };
  }

  if (name === "ask_user" && isRecord(args)) {
    return {
      action: "ask_user",
      message: typeof args.message === "string" ? args.message : undefined,
      thinking: normalizeThinking(args.thinking),
      questions: normalizeQuestions(args.questions)
    };
  }

  if (name === "submit_card" && isRecord(args)) {
    return {
      action: "submit_card",
      message: typeof args.message === "string" ? args.message : undefined,
      thinking: normalizeThinking(args.thinking),
      status: args.status === "final" ? "final" : "draft",
      card: normalizeCard(args.card, kind)
    };
  }

  return null;
}

export function normalizeQuestions(value: unknown): AskQuestion[] {
  const fallback: AskQuestion[] = [
    {
      question: "还需要补充这个角色最重要的关系、语气或冲突是什么？",
      options: [
        { label: "暧昧拉扯", description: "适合继续做亲密关系或互相试探。" },
        { label: "敌对冲突", description: "适合强张力、任务或对抗开局。" },
        { label: "日常相遇", description: "适合慢热、自然进入对话。" }
      ]
    }
  ];

  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item): AskQuestion | null => {
      if (typeof item === "string") {
        const question = item.trim();
        return question ? { question, options: [] } : null;
      }

      if (!isRecord(item)) {
        return null;
      }

      const question = typeof item.question === "string"
        ? item.question.trim()
        : typeof item.text === "string"
          ? item.text.trim()
          : "";

      if (!question) {
        return null;
      }

      return {
        question,
        options: normalizeOptions(item.options),
        multiSelect: item.multiSelect === true ? true : undefined
      };
    })
    .filter((item): item is AskQuestion => Boolean(item))
    .slice(0, 3);

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        const label = item.trim();
        return label ? { label } : null;
      }

      if (!isRecord(item) || typeof item.label !== "string") {
        return null;
      }

      const label = item.label.trim();
      if (!label) {
        return null;
      }

      return {
        label,
        description: typeof item.description === "string" ? item.description.trim() : undefined
      };
    })
    .filter((item): item is { label: string; description?: string } => Boolean(item))
    .slice(0, 4);
}

export function parseLooseJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");

  if (first === -1 || last === -1 || last < first) {
    throw new Error("No JSON object found in LLM response.");
  }

  const json = candidate.slice(first, last + 1);
  const parsed = JSON.parse(json) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("LLM JSON response must be an object.");
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeThinking(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : undefined;
}

function extractThinkingFromText(text: string): string | undefined {
  const matches = Array.from(text.matchAll(/<think>([\s\S]*?)<\/think>/gi))
    .map((match) => match[1]?.trim())
    .filter(Boolean);

  return normalizeThinking(matches.join("\n\n"));
}

function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
