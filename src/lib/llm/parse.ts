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

  if (parsed.action === "web_fetch" && typeof parsed.url === "string") {
    return {
      action: "web_fetch",
      url: parsed.url.trim()
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

  if (name === "web_fetch" && isRecord(args) && typeof args.url === "string") {
    return {
      action: "web_fetch",
      url: args.url.trim()
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
        return question ? { question, options: ensureMinimumOptions([]) } : null;
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
        options: ensureMinimumOptions(normalizeOptions(item.options)),
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

function ensureMinimumOptions(options: Array<{ label: string; description?: string }>) {
  const fallbackOptions = [
    { label: "保持原设定", description: "尽量贴近我已经给出的描述。" },
    { label: "更柔和", description: "降低冲突，让开场更自然慢热。" },
    { label: "更强张力", description: "强化关系冲突、秘密或戏剧性。" }
  ];

  const merged = [...options];
  for (const option of fallbackOptions) {
    if (merged.length >= 3) {
      break;
    }
    if (!merged.some((item) => item.label === option.label)) {
      merged.push(option);
    }
  }

  return merged.slice(0, 4);
}

export function parseLooseJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  // Step 1: try direct parse (pure JSON, no surrounding text)
  const direct = tryParseJson(trimmed);
  if (direct !== null && isRecord(direct)) {
    return direct;
  }

  // Step 2: try extracting from ```json ... ``` fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParseJson(fenced.trim());
    if (parsed !== null && isRecord(parsed)) {
      return parsed;
    }
  }

  // Step 3: try finding the outermost { ... } pair
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = trimmed.slice(first, last + 1);
    const parsed = tryParseJson(candidate);
    if (parsed !== null && isRecord(parsed)) {
      return parsed;
    }

    // Step 4: attempt common LLM JSON mistakes repair
    const repaired = repairJsonString(candidate);
    const parsedRepaired = tryParseJson(repaired);
    if (parsedRepaired !== null && isRecord(parsedRepaired)) {
      return parsedRepaired;
    }
  }

  throw new Error("No JSON object found in LLM response.");
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function repairJsonString(text: string): string {
  let repaired = text;

  // Strip trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  // Escape unescaped newlines inside string values:
  // replace literal newlines that appear between quotes with \n
  repaired = repaired.replace(
    /("(?:[^"\\]|\\.)*")/g,
    (match) => match.replace(/\n/g, "\\n").replace(/\r/g, "")
  );

  // Replace single quotes used as string delimiters with double quotes
  // (conservative: only if the string looks like it uses single quotes)
  if (!repaired.includes('"') && repaired.includes("'")) {
    repaired = repaired.replace(/'/g, '"');
  }

  return repaired;
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
