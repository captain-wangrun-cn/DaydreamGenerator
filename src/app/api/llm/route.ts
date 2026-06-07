import { NextResponse } from "next/server";
import { z } from "zod";
import { cardKindSchema, characterCardV2Schema } from "@/lib/card-schema";
import { buildProviderPayload, enforceInterviewBeforeSubmit, fetchLlmWithRetry, formatSearchResults } from "@/lib/llm/providers";
import type { LlmTurnRequest, WebSearchResultItem } from "@/lib/llm/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  config: z.object({
    provider: z.enum(["openai", "gemini", "anthropic", "openai-compatible"]),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.string().optional(),
    remember: z.boolean().optional(),
    useTools: z.boolean().optional(),
    directPreferred: z.boolean().optional(),
    tavilyKey: z.string().optional()
  }),
  kind: cardKindSchema,
  prompt: z.string().default(""),
  language: z.enum(["zh-CN", "en-US", "ja-JP"]).default("zh-CN"),
  answers: z.string().default(""),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).default([]),
  media: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    kind: z.enum(["image", "video"]),
    dataUrl: z.string(),
    size: z.number(),
    useAsAvatar: z.boolean().optional()
  })).default([]),
  currentCard: characterCardV2Schema.optional()
});

const MAX_SEARCH_ROUNDS = 3;

export async function POST(request: Request) {
  try {
    let body = requestSchema.parse(await request.json()) as unknown as LlmTurnRequest;
    const searches: string[] = [];

    for (let round = 0; round <= MAX_SEARCH_ROUNDS; round++) {
      const payload = buildProviderPayload(body);
      const { response, json } = await fetchLlmWithRetry(payload.url, payload.init);

      if (!response.ok) {
        const message = extractError(json) ?? response.statusText;
        return NextResponse.json({ error: `LLM request failed: ${message}` }, { status: 502 });
      }

      const result = enforceInterviewBeforeSubmit(payload.parser(json, body.kind), body);

      if (result.action !== "web_search") {
        if (searches.length > 0) {
          result.searches = searches;
        }
        return NextResponse.json(result);
      }

      if (round === MAX_SEARCH_ROUNDS) {
        return NextResponse.json({ error: "LLM exceeded maximum search rounds." }, { status: 400 });
      }

      searches.push(result.query);
      const searchResults = await serverSearch(result.query, body.config.tavilyKey);
      const searchSummary = formatSearchResults(searchResults);

      body = {
        ...body,
        messages: [
          ...body.messages,
          { role: "assistant", content: `[web_search: ${result.query}]` },
          { role: "user", content: `搜索结果：\n${searchSummary}\n\n请根据以上搜索结果继续生成角色卡，或提出更多问题。` }
        ]
      };
    }

    return NextResponse.json({ error: "Unexpected end of search loop." }, { status: 500 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown LLM proxy error." },
      { status: 400 }
    );
  }
}

async function serverSearch(query: string, clientKey?: string): Promise<WebSearchResultItem[]> {
  const apiKey = process.env.TAVILY_API_KEY || clientKey || "";
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false
      })
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return ((data as { results?: WebSearchResultItem[] }).results ?? []).slice(0, 5).map((item) => ({
      title: item.title || "",
      url: item.url || "",
      content: (item.content || "").slice(0, 500)
    }));
  } catch {
    return [];
  }
}

function extractError(value: unknown): string | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.error === "object" && record.error !== null) {
      const inner = record.error as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return null;
}
