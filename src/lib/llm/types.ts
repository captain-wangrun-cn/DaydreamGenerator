import type { CharacterCardV2, CardKind } from "@/lib/card-schema";

export type ProviderId = "openai" | "gemini" | "anthropic" | "openai-compatible";
export type UiLanguage = "zh-CN" | "en-US" | "ja-JP";
export type CardMode = "normal" | "story";

export type LlmConfig = {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  remember?: boolean;
  useTools?: boolean;
  directPreferred?: boolean;
  tavilyKey?: string;
};

export type MediaAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "video";
  dataUrl: string;
  size: number;
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type LlmTurnRequest = {
  config: LlmConfig;
  kind: CardKind;
  mode?: CardMode;
  prompt: string;
  language?: UiLanguage;
  answers: string;
  messages: ChatMessage[];
  media: MediaAttachment[];
  currentCard?: CharacterCardV2;
};

export type LlmProgressEvent =
  | { type: "provider_connecting"; round: number }
  | { type: "provider_connected"; round: number; status: number }
  | { type: "provider_first_byte"; round: number }
  | { type: "web_search"; round: number; query: string }
  | { type: "web_fetch"; round: number; url: string }
  | { type: "token"; text: string }
  | { type: "search_progress"; searches: string[]; messages: ChatMessage[] };

export type LlmProgressListener = (event: LlmProgressEvent) => void | Promise<void>;

export type AskOption = {
  label: string;
  description?: string;
};

export type AskQuestion = {
  question: string;
  options: AskOption[];
  multiSelect?: boolean;
};

export type AskUserResult = {
  action: "ask_user";
  message?: string;
  thinking?: string;
  questions: AskQuestion[];
  searches?: string[];
};

export type SubmitCardResult = {
  action: "submit_card";
  message?: string;
  thinking?: string;
  status: "draft" | "final";
  card: CharacterCardV2;
  searches?: string[];
};

export type LlmTurnResult = AskUserResult | SubmitCardResult;

export type WebSearchCall = {
  action: "web_search";
  query: string;
};

export type WebFetchCall = {
  action: "web_fetch";
  url: string;
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  content: string;
};

export type LlmTurnOrSearchResult = LlmTurnResult | WebSearchCall | WebFetchCall;

export type ProviderPayload = {
  url: string;
  init: RequestInit;
  parser: (response: unknown, kind: CardKind) => LlmTurnOrSearchResult;
};
