import { normalizeCard, type CardKind } from "@/lib/card-schema";
import { dataUrlToBase64 } from "@/lib/media";
import { buildUserPrompt, buildEditUserPrompt, editorFallbackJsonInstruction, editorSystemPrompt, fallbackJsonInstruction, generatorSystemPrompt } from "@/lib/llm/prompt";
import { anthropicTools, anthropicEditorTools, geminiTools, geminiEditorTools, openAiTools, openAiEditorTools } from "@/lib/llm/tools";
import { parseFallbackJson, parseLooseJson, parseToolResult } from "@/lib/llm/parse";
import type { LlmProgressListener, LlmTurnOrSearchResult, LlmTurnRequest, LlmTurnResult, MediaAttachment, ProviderPayload, WebSearchResultItem } from "@/lib/llm/types";

type WebSearchExecutor = (query: string, clientKey?: string) => Promise<WebSearchResultItem[]>;
type WebFetchExecutor = (url: string) => Promise<string>;

export class LlmRequestError extends Error {
  readonly detail: string;
  readonly status?: number;

  constructor(message: string, detail: string, status?: number) {
    super(message);
    this.name = "LlmRequestError";
    this.detail = detail;
    this.status = status;
  }
}

export function buildProviderPayload(request: LlmTurnRequest): ProviderPayload {
  if (request.skipInterview) {
    return buildEditProviderPayload(request);
  }
  switch (request.config.provider) {
    case "openai":
      return buildOpenAiPayload(request, "https://api.openai.com/v1");
    case "openai-compatible":
      return buildOpenAiPayload(request, request.config.baseUrl);
    case "anthropic":
      return buildAnthropicPayload(request);
    case "gemini":
      return buildGeminiPayload(request);
    default:
      throw new Error("Unsupported provider.");
  }
}

export async function sendLlmTurn(
  request: LlmTurnRequest,
  onProgress?: LlmProgressListener,
  options: { search?: WebSearchExecutor; fetch?: WebFetchExecutor } = {}
): Promise<LlmTurnResult> {
  const maxSearchRounds = 3;
  const searches: string[] = [];
  const search = options.search ?? executeWebSearch;
  const fetchPage = options.fetch ?? executeWebFetch;

  for (let round = 0; round <= maxSearchRounds; round++) {
    const payload = buildProviderPayload(request);
    await onProgress?.({ type: "provider_connecting", round });
    let fetched: { response: Response; json: unknown; responseText: string };
    try {
      fetched = await fetchLlmWithRetry(payload.url, payload.init, {
        onConnected: (status) => onProgress?.({ type: "provider_connected", round, status }),
        onFirstByte: () => onProgress?.({ type: "provider_first_byte", round }),
        onChunk: (chunk) => onProgress?.({ type: "token", text: chunk })
      });
    } catch (error) {
      // Emit checkpoint so frontend can resume from accumulated search context
      if (searches.length > 0) {
        await onProgress?.({ type: "search_progress", searches: [...searches], messages: [...request.messages] });
      }
      const message = error instanceof Error ? error.message : "Network request failed.";
      throw new LlmRequestError(
        `LLM request failed: ${message}`,
        formatProviderRequestFailureDetail(payload.url, request.config.provider, error)
      );
    }

    const { response, json, responseText } = fetched;

    if (!response.ok) {
      if (searches.length > 0) {
        await onProgress?.({ type: "search_progress", searches: [...searches], messages: [...request.messages] });
      }
      const message = extractProviderError(json) ?? response.statusText;
      throw new LlmRequestError(
        `LLM request failed: ${message}`,
        formatProviderErrorDetail(payload.url, request.config.provider, response, responseText, json),
        response.status
      );
    }

    let parsed: LlmTurnOrSearchResult;
    try {
      parsed = payload.parser(json, request.kind);
    } catch (error) {
      if (searches.length > 0) {
        await onProgress?.({ type: "search_progress", searches: [...searches], messages: [...request.messages] });
      }
      const message = error instanceof Error ? error.message : "LLM response parsing failed.";
      throw new LlmRequestError(
        `LLM response parsing failed: ${message}`,
        formatProviderErrorDetail(payload.url, request.config.provider, response, responseText, json, error),
        response.status
      );
    }

    const result = enforceInterviewBeforeSubmit(parsed, request);

    if (result.action !== "web_search" && result.action !== "web_fetch") {
      if (searches.length > 0) {
        result.searches = searches;
      }
      return result;
    }

    if (round === maxSearchRounds) {
      throw new Error("LLM exceeded maximum search rounds.");
    }

    if (result.action === "web_search") {
      searches.push(result.query);
      await onProgress?.({ type: "web_search", round, query: result.query });
      const searchResults = await search(result.query, request.config.tavilyKey);
      const searchSummary = formatSearchResults(searchResults);

      request = {
        ...request,
        messages: [
          ...request.messages,
          { role: "assistant", content: `[web_search: ${result.query}]` },
          { role: "user", content: `搜索结果：\n${searchSummary}\n\n请根据以上搜索结果继续生成角色卡，或提出更多问题。` }
        ]
      };
    } else {
      searches.push(`[fetch] ${result.url}`);
      await onProgress?.({ type: "web_fetch", round, url: result.url });
      const fetchContent = await fetchPage(result.url);

      request = {
        ...request,
        messages: [
          ...request.messages,
          { role: "assistant", content: `[web_fetch: ${result.url}]` },
          { role: "user", content: `网页内容：\n${fetchContent || "未能获取到内容。"}\n\n请根据以上网页内容继续生成角色卡，或提出更多问题。` }
        ]
      };
    }

    // Emit checkpoint after successful search round
    await onProgress?.({ type: "search_progress", searches: [...searches], messages: [...request.messages] });
  }

  throw new Error("Unexpected end of search loop.");
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Fetch an LLM endpoint with retry on transient failures (network errors,
 * 429 rate limits, 5xx). Non-retryable responses (e.g. 400/401) are returned
 * as-is for the caller to handle. Uses exponential backoff with jitter.
 */
export async function fetchLlmWithRetry(
  url: string,
  init: RequestInit,
  options: {
    retries?: number;
    baseDelayMs?: number;
    onConnected?: (status: number) => void | Promise<void>;
    onFirstByte?: () => void | Promise<void>;
    onChunk?: (chunk: string) => void | Promise<void>;
  } = {}
): Promise<{ response: Response; json: unknown; responseText: string }> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 600;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      await options.onConnected?.(response.status);
      const responseText = await readResponseText(response, {
        onFirstByte: response.ok ? options.onFirstByte : undefined,
        onChunk: response.ok ? options.onChunk : undefined
      });
      const json = parseResponseJson(responseText);

      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        return { response, json, responseText };
      }
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        throw error;
      }
    }

    const delay = baseDelayMs * 2 ** attempt + Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError instanceof Error ? lastError : new Error("LLM request failed after retries.");
}

function parseResponseJson(responseText: string): unknown {
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

async function readResponseText(
  response: Response,
  options: { onFirstByte?: () => void | Promise<void>; onChunk?: (chunk: string) => void | Promise<void> } = {}
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (text) {
      await options.onFirstByte?.();
      await options.onChunk?.(text);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let sawChunk = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      if (!sawChunk) {
        sawChunk = true;
        await options.onFirstByte?.();
      }
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      await options.onChunk?.(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  text += decoder.decode();
  return text;
}

export async function executeWebSearch(query: string, clientKey?: string): Promise<WebSearchResultItem[]> {
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, tavilyKey: clientKey })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = (data as Record<string, unknown>)?.error ?? "Search failed";
    throw new Error(String(message));
  }

  const data = await response.json();
  return (data as { results: WebSearchResultItem[] }).results ?? [];
}

export async function executeWebFetch(url: string): Promise<string> {
  const response = await fetch("/api/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = (data as Record<string, unknown>)?.error ?? "Fetch failed";
    throw new Error(String(message));
  }

  const data = await response.json();
  return (data as { content: string }).content ?? "";
}

export function formatSearchResults(results: WebSearchResultItem[]): string {
  if (results.length === 0) {
    return "未找到相关结果。";
  }

  return results
    .map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}\n   ${item.content}`)
    .join("\n\n");
}

export function enforceInterviewBeforeSubmit(result: LlmTurnOrSearchResult, request: LlmTurnRequest): LlmTurnOrSearchResult {
  if (request.skipInterview) {
    return result;
  }
  if (result.action !== "submit_card" || hasCompletedInterview(request)) {
    return result;
  }

  return {
    action: "ask_user",
    message: "我还需要先确认几个会明显影响角色卡的设定。",
    thinking: result.thinking,
    questions: [
      {
        question: "这张角色卡最需要优先锁定哪一类核心设定？",
        options: [
          { label: "关系张力", description: "先确定角色和用户之间的亲疏、冲突或暧昧。" },
          { label: "人设口吻", description: "先确定说话方式、性格习惯和互动边界。" },
          { label: "开场情境", description: "先确定用户进入对话时发生了什么。" }
        ]
      }
    ],
    searches: result.searches
  };
}

function hasCompletedInterview(request: LlmTurnRequest): boolean {
  if (request.answers.trim()) {
    return true;
  }

  return request.messages.some((message) => (
    message.role === "user" && /回答[:：]/.test(message.content)
  ));
}

function buildEditProviderPayload(request: LlmTurnRequest): ProviderPayload {
  switch (request.config.provider) {
    case "openai":
      return buildEditOpenAiPayload(request, "https://api.openai.com/v1");
    case "openai-compatible":
      return buildEditOpenAiPayload(request, request.config.baseUrl);
    case "anthropic":
      return buildEditAnthropicPayload(request);
    case "gemini":
      return buildEditGeminiPayload(request);
    default:
      throw new Error("Unsupported provider.");
  }
}

function buildEditOpenAiPayload(request: LlmTurnRequest, defaultBaseUrl?: string): ProviderPayload {
  const baseUrl = normalizeBaseUrl(request.config.baseUrl || defaultBaseUrl);
  if (!baseUrl) {
    throw new Error("OpenAI-compatible providers need a base URL.");
  }

  const prompt = buildEditUserPrompt(request);
  const content: unknown[] = [
    {
      type: "text",
      text: prompt
    }
  ];

  const body: Record<string, unknown> = {
    model: request.config.model,
    messages: [
      {
        role: "system",
        content: `${editorSystemPrompt()}\n\n${editorFallbackJsonInstruction}`
      },
      {
        role: "user",
        content
      }
    ],
    temperature: 0.8
  };

  if (request.config.useTools !== false) {
    body.tools = openAiEditorTools();
    body.tool_choice = "auto";
  } else {
    body.response_format = { type: "json_object" };
  }

  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    parser: parseOpenAiResponse
  };
}

function buildEditAnthropicPayload(request: LlmTurnRequest): ProviderPayload {
  const baseUrl = normalizeBaseUrl(request.config.baseUrl || "https://api.anthropic.com/v1");
  const prompt = buildEditUserPrompt(request);
  const content: unknown[] = [
    {
      type: "text",
      text: `${prompt}\n\n${editorFallbackJsonInstruction}`
    }
  ];

  const body: Record<string, unknown> = {
    model: request.config.model,
    max_tokens: 4096,
    system: editorSystemPrompt(),
    messages: [
      {
        role: "user",
        content
      }
    ]
  };

  if (request.config.useTools !== false) {
    body.tools = anthropicEditorTools();
  }

  return {
    url: `${baseUrl}/messages`,
    init: {
      method: "POST",
      headers: {
        "x-api-key": request.config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    parser: parseAnthropicResponse
  };
}

function buildEditGeminiPayload(request: LlmTurnRequest): ProviderPayload {
  const baseUrl = normalizeBaseUrl(request.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
  const prompt = `${editorSystemPrompt()}\n\n${editorFallbackJsonInstruction}\n\n${buildEditUserPrompt(request)}`;
  const parts: unknown[] = [
    {
      text: prompt
    }
  ];

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    generationConfig: {
      temperature: 0.8
    }
  };

  if (request.config.useTools !== false) {
    body.tools = geminiEditorTools();
  } else {
    body.generationConfig = {
      temperature: 0.8,
      responseMimeType: "application/json"
    };
  }

  const model = encodeURIComponent(request.config.model);
  const separator = baseUrl.includes("?") ? "&" : "?";

  return {
    url: `${baseUrl}/models/${model}:generateContent${separator}key=${encodeURIComponent(request.config.apiKey)}`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    parser: parseGeminiResponse
  };
}

function buildOpenAiPayload(request: LlmTurnRequest, defaultBaseUrl?: string): ProviderPayload {
  const baseUrl = normalizeBaseUrl(request.config.baseUrl || defaultBaseUrl);
  if (!baseUrl) {
    throw new Error("OpenAI-compatible providers need a base URL.");
  }

  const prompt = buildUserPrompt(request);
  const content: unknown[] = [
    {
      type: "text",
      text: prompt
    },
    ...request.media
      .filter((item) => item.kind === "image")
      .map((item) => ({
        type: "image_url",
        image_url: {
          url: item.dataUrl
        }
      }))
  ];

  const body: Record<string, unknown> = {
    model: request.config.model,
    messages: [
      {
        role: "system",
        content: `${generatorSystemPrompt(request.mode)}\n\n${fallbackJsonInstruction}`
      },
      {
        role: "user",
        content
      }
    ],
    temperature: 0.8
  };

  if (request.config.useTools !== false) {
    body.tools = openAiTools(request.mode);
    body.tool_choice = "auto";
  } else {
    body.response_format = { type: "json_object" };
  }

  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    parser: parseOpenAiResponse
  };
}

function buildAnthropicPayload(request: LlmTurnRequest): ProviderPayload {
  const baseUrl = normalizeBaseUrl(request.config.baseUrl || "https://api.anthropic.com/v1");
  const prompt = buildUserPrompt(request);
  const content: unknown[] = [
    {
      type: "text",
      text: `${prompt}\n\n${fallbackJsonInstruction}`
    },
    ...request.media
      .filter((item) => item.kind === "image")
      .map((item) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: item.mimeType,
          data: dataUrlToBase64(item.dataUrl)
        }
      }))
  ];

  const body: Record<string, unknown> = {
    model: request.config.model,
    max_tokens: 4096,
    system: generatorSystemPrompt(request.mode),
    messages: [
      {
        role: "user",
        content
      }
    ]
  };

  if (request.config.useTools !== false) {
    body.tools = anthropicTools(request.mode);
  }

  return {
    url: `${baseUrl}/messages`,
    init: {
      method: "POST",
      headers: {
        "x-api-key": request.config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    parser: parseAnthropicResponse
  };
}

function buildGeminiPayload(request: LlmTurnRequest): ProviderPayload {
  const baseUrl = normalizeBaseUrl(request.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
  const prompt = `${generatorSystemPrompt(request.mode)}\n\n${fallbackJsonInstruction}\n\n${buildUserPrompt(request)}`;
  const parts: unknown[] = [
    {
      text: prompt
    },
    ...request.media.map((item) => ({
      inlineData: {
        mimeType: item.mimeType,
        data: dataUrlToBase64(item.dataUrl)
      }
    }))
  ];

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    generationConfig: {
      temperature: 0.8
    }
  };

  if (request.config.useTools !== false) {
    body.tools = geminiTools(request.mode);
  } else {
    body.generationConfig = {
      temperature: 0.8,
      responseMimeType: "application/json"
    };
  }

  const model = encodeURIComponent(request.config.model);
  const separator = baseUrl.includes("?") ? "&" : "?";

  return {
    url: `${baseUrl}/models/${model}:generateContent${separator}key=${encodeURIComponent(request.config.apiKey)}`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    parser: parseGeminiResponse
  };
}

function parseOpenAiResponse(response: unknown, kind: CardKind): LlmTurnOrSearchResult {
  const choice = getPath<Record<string, unknown>>(response, ["choices", 0, "message"]);
  const toolCall = getPath<Record<string, unknown>>(choice, ["tool_calls", 0]);
  const functionCall = getPath<Record<string, unknown>>(toolCall, ["function"]);
  const thinking = extractReasoningText(choice);

  if (functionCall && typeof functionCall.name === "string") {
    const args = typeof functionCall.arguments === "string"
      ? parseLooseJson(functionCall.arguments)
      : functionCall.arguments;
    const parsed = parseToolResult(functionCall.name, args, kind);
    if (parsed) {
      return withThinking(parsed, thinking);
    }
  }

  const content = typeof choice?.content === "string" ? choice.content : "";
  return withThinking(parseFallbackJson(content, kind), thinking);
}

function parseAnthropicResponse(response: unknown, kind: CardKind): LlmTurnOrSearchResult {
  const content = getArray(getPath(response, ["content"]));
  const tool = content.find((item) => isRecord(item) && item.type === "tool_use");
  const thinking = content
    .filter((item) => isRecord(item) && item.type === "thinking")
    .map((item) => extractReasoningText(item))
    .filter((item): item is string => Boolean(item))
    .join("\n\n");

  if (isRecord(tool) && typeof tool.name === "string") {
    const parsed = parseToolResult(tool.name, tool.input, kind);
    if (parsed) {
      return withThinking(parsed, thinking);
    }
  }

  const text = content
    .filter((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => String((item as { text: string }).text))
    .join("\n");

  return withThinking(parseFallbackJson(text, kind), thinking);
}

function parseGeminiResponse(response: unknown, kind: CardKind): LlmTurnOrSearchResult {
  const parts = getArray(getPath(response, ["candidates", 0, "content", "parts"]));
  const functionPart = parts.find((item) => isRecord(item) && isRecord(item.functionCall));
  const thinking = parts
    .filter((item) => isRecord(item) && item.thought === true && typeof item.text === "string")
    .map((item) => String((item as { text: string }).text))
    .join("\n\n");

  if (isRecord(functionPart) && isRecord(functionPart.functionCall)) {
    const call = functionPart.functionCall;
    if (typeof call.name === "string") {
      const parsed = parseToolResult(call.name, call.args, kind);
      if (parsed) {
        return withThinking(parsed, thinking);
      }
    }
  }

  const text = parts
    .filter((item) => isRecord(item) && item.thought !== true && typeof item.text === "string")
    .map((item) => String((item as { text: string }).text))
    .join("\n");

  return withThinking(parseFallbackJson(text, kind), thinking);
}

function normalizeBaseUrl(url?: string): string {
  if (!url) {
    return "";
  }

  return url.replace(/\/+$/, "");
}

function extractProviderError(value: unknown): string | null {
  if (isRecord(value)) {
    if (typeof value.error === "string") {
      return value.error;
    }

    if (isRecord(value.error) && typeof value.error.message === "string") {
      return value.error.message;
    }

    if (typeof value.message === "string") {
      return value.message;
    }
  }

  return null;
}

function formatProviderErrorDetail(
  url: string,
  provider: LlmTurnRequest["config"]["provider"],
  response: Response,
  responseText: string,
  json: unknown,
  cause?: unknown
): string {
  const sections = [
    `Provider: ${provider}`,
    `Endpoint: ${redactSensitiveUrl(url)}`,
    `HTTP status: ${response.status} ${response.statusText || ""}`.trim()
  ];

  const causeText = formatUnknownError(cause);
  if (causeText) {
    sections.push(`Local error:\n${causeText}`);
  }

  if (responseText) {
    sections.push(`Raw response body:\n${responseText}`);
  }

  const parsedText = typeof json === "string" ? "" : safeStringify(json);
  if (parsedText && parsedText !== responseText) {
    sections.push(`Parsed response JSON:\n${parsedText}`);
  }

  return sections.join("\n\n");
}

function formatProviderRequestFailureDetail(
  url: string,
  provider: LlmTurnRequest["config"]["provider"],
  cause: unknown
): string {
  return [
    `Provider: ${provider}`,
    `Endpoint: ${redactSensitiveUrl(url)}`,
    `Network/local error:\n${formatUnknownError(cause) || "Unknown request failure."}`
  ].join("\n\n");
}

function redactSensitiveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of parsed.searchParams.keys()) {
      if (/key|token|secret|password/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&][^=]*(?:key|token|secret|password)[^=]*=)[^&\s]+/gi, "$1[redacted]");
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatUnknownError(error: unknown): string {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return typeof error === "string" ? error : safeStringify(error);
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getPath<T = unknown>(value: unknown, path: Array<string | number>): T | undefined {
  let current = value;

  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[key];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }

  return current as T | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withThinking(result: LlmTurnOrSearchResult, thinking?: string): LlmTurnOrSearchResult {
  const normalized = normalizeReasoningText(thinking);
  if (!normalized || result.action === "web_search" || result.action === "web_fetch" || result.thinking) {
    return result;
  }

  return {
    ...result,
    thinking: normalized
  };
}

function extractReasoningText(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return normalizeReasoningText(value);
  }

  return normalizeReasoningText(
    value.thinking ??
    value.reasoning_content ??
    value.reasoning ??
    value.summary ??
    value.text
  );
}

function normalizeReasoningText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 4000) : undefined;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractReasoningText(item))
      .filter(Boolean)
      .join("\n\n");
    return normalizeReasoningText(text);
  }

  if (isRecord(value)) {
    return extractReasoningText(value);
  }

  return undefined;
}

export function makeLocalDraft(request: Pick<LlmTurnRequest, "kind" | "mode" | "prompt" | "answers" | "language">): LlmTurnResult {
  const title = request.prompt.split(/[\n，。,.]/).map((part) => part.trim()).find(Boolean);
  const card = normalizeCard({
    name: title ? title.slice(0, 24) : "未命名角色",
    description: request.prompt || "根据用户描述生成的卡片草稿。",
    personality: "请在预览中补充角色性格、口吻和行为习惯。",
    scenario: request.answers || "请在预览中补充场景、关系和当前冲突。",
    first_mes: localDraftFirstMessage(request.language),
    tags: ["draft"]
  }, "character");

  return {
    action: "submit_card",
    status: "draft",
    message: "未调用 LLM，已根据当前描述生成一个可编辑草稿。",
    card
  };
}

function localDraftFirstMessage(language: LlmTurnRequest["language"]): string {
  switch (language) {
    case "en-US":
      return "Hi, I have been waiting for you.";
    case "ja-JP":
      return "こんにちは、ずっとあなたを待っていました。";
    default:
      return "你好，我一直在等你。";
  }
}

export function unsupportedMediaWarning(provider: string, media: MediaAttachment[]): string | null {
  const hasVideo = media.some((item) => item.kind === "video");
  if (hasVideo && provider !== "gemini") {
    return "视频素材仅 Gemini 模式会发送给 LLM；当前 Provider 会忽略视频，只保留文字描述。";
  }

  return null;
}
