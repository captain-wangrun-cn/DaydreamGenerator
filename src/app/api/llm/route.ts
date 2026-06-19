import { NextResponse } from "next/server";
import { z } from "zod";
import { cardKindSchema, characterCardV2Schema } from "@/lib/card-schema";
import { LlmRequestError, sendLlmTurn } from "@/lib/llm/providers";
import type { LlmProgressEvent, LlmTurnRequest, LlmTurnResult, WebSearchResultItem } from "@/lib/llm/types";

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

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json()) as unknown as LlmTurnRequest;

    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return streamLlmTurn(body);
    }

    const result = await sendLlmTurn(body, undefined, { search: serverSearch, fetch: serverFetch });
    return NextResponse.json(result);
  } catch (error) {
    const { message, detail } = formatLlmProxyError(error);
    return NextResponse.json(
      { error: message, detail },
      { status: message.startsWith("LLM request failed:") ? 502 : 400 }
    );
  }
}

function streamLlmTurn(body: LlmTurnRequest): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: "progress" | "result" | "error", data: LlmProgressEvent | LlmTurnResult | { error: string; detail?: string }) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await sendLlmTurn(body, (event) => send("progress", event), { search: serverSearch, fetch: serverFetch });
        send("result", result);
      } catch (error) {
        const { message, detail } = formatLlmProxyError(error);
        send("error", { error: message, detail });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function formatLlmProxyError(error: unknown): { message: string; detail: string } {
  if (error instanceof LlmRequestError) {
    return {
      message: error.message,
      detail: error.detail || error.stack || error.message
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      detail: error.stack || error.message
    };
  }

  return {
    message: "Unknown LLM proxy error.",
    detail: String(error)
  };
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

async function serverFetch(url: string): Promise<string> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers: Record<string, string> = {
      Accept: "text/markdown"
    };

    const jinaKey = process.env.JINA_API_KEY;
    if (jinaKey) {
      headers["Authorization"] = `Bearer ${jinaKey}`;
    }

    const response = await fetch(jinaUrl, {
      headers,
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return "";
    }

    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return "";
  }
}
