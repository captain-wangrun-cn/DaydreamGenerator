"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createEmptyCard, isShareableCard, normalizeCard, type CharacterCardV2 } from "@/lib/card-schema";
import { copy, isUiLanguage, languageOptions, uiLocale } from "@/lib/i18n";
import { LlmRequestError, sendLlmTurn, makeLocalDraft, unsupportedMediaWarning } from "@/lib/llm/providers";
import type { AskQuestion, CardMode, ChatMessage, LlmConfig, LlmProgressEvent, LlmTurnResult, MediaAttachment, ProviderId, UiLanguage } from "@/lib/llm/types";
import { filesToAttachments, clearMediaStore, loadMediaFromStore, saveMediaToStore } from "@/lib/media";
import { embedCardInPngDataUrl } from "@/lib/png-card";

const CONFIG_STORAGE_KEY = "daydream-generator.llm-config.v1";
const HISTORY_STORAGE_KEY = "daydream-generator.history.v1";
const LANGUAGE_STORAGE_KEY = "daydream-generator.language.v1";
const WORKFLOW_STORAGE_KEY = "daydream-generator.workflow.v1";
const MEDIA_STORE_KEY = "daydream-generator.media.v1";
const MAX_HISTORY_ITEMS = 30;

const providerDefaults: Record<ProviderId, { model: string; baseUrl: string; label: string }> = {
  openai: {
    label: "OpenAI",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1"
  },
  gemini: {
    label: "Gemini",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta"
  },
  anthropic: {
    label: "Anthropic",
    model: "claude-3-5-sonnet-latest",
    baseUrl: "https://api.anthropic.com/v1"
  },
  "openai-compatible": {
    label: "OpenAI-Compatible",
    model: "local-model",
    baseUrl: "http://localhost:8000/v1"
  }
};

const initialConfig: LlmConfig = {
  provider: "openai",
  apiKey: "",
  model: providerDefaults.openai.model,
  baseUrl: providerDefaults.openai.baseUrl,
  useTools: true,
  directPreferred: true
};

const TOTAL_STEPS = 5;

type ShareResponse = {
  url: string;
  expiresAt: number;
  filename: string;
  contentType: string;
};

type InterviewState = {
  questions: AskQuestion[];
  currentIndex: number;
  answers: string[];
  customAnswer: string;
};

type HistoryItem = {
  id: string;
  createdAt: number;
  card: CharacterCardV2;
  prompt: string;
  answers: string;
  messages: ChatMessage[];
  avatarImage: MediaAttachment | null;
  share: ShareResponse | null;
  source: "llm" | "draft" | "manual";
};

type PendingAvatarCrop = {
  original: MediaAttachment;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type LlmStreamEvent = {
  event: "progress" | "result" | "error" | "message";
  data: unknown;
};

type LlmErrorInfo = {
  message: string;
  detail: string;
};

type WorkflowSnapshot = {
  version: 1;
  savedAt: number;
  step: number;
  prompt: string;
  mode: CardMode;
  answers: string;
  messages: ChatMessage[];
  card: CharacterCardV2;
  jsonText: string;
  interview: InterviewState | null;
  lastCheckpoint: { searches: string[]; messages: ChatMessage[] } | null;
  hasGenerated: boolean;
  hasGeneratedCard: boolean;
  searchLogs: string[];
  thinking: string;
  referenceMediaCount: number;
};

class LlmClientError extends Error {
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = "LlmClientError";
    this.detail = detail;
  }
}

export function CardGenerator() {
  const [language, setLanguage] = useState<UiLanguage>(() => getInitialLanguage());
  const t = copy[language];
  const [config, setConfig] = useState<LlmConfig>(initialConfig);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<CardMode>("normal");
  const [answers, setAnswers] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [referenceMedia, setReferenceMedia] = useState<MediaAttachment[]>([]);
  const [avatarImage, setAvatarImage] = useState<MediaAttachment | null>(null);
  const [cropAvatarUploads, setCropAvatarUploads] = useState(false);
  const [pendingAvatarCrop, setPendingAvatarCrop] = useState<PendingAvatarCrop | null>(null);
  const [card, setCard] = useState<CharacterCardV2>(() => createEmptyCard("character"));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(createEmptyCard("character"), null, 2));
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [status, setStatus] = useState(t.ready);
  const [error, setErrorMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [errorDetailCopied, setErrorDetailCopied] = useState(false);
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [historyShareBusyId, setHistoryShareBusyId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expiresIn, setExpiresIn] = useState<"1h" | "24h" | "7d">("24h");
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [hasGeneratedCard, setHasGeneratedCard] = useState(false);
  const [isCurrentCardShareable, setIsCurrentCardShareable] = useState(false);
  const [searchLogs, setSearchLogs] = useState<string[]>([]);
  const [thinking, setThinking] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [lastCheckpoint, setLastCheckpoint] = useState<{ searches: string[]; messages: ChatMessage[] } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => {
    if (typeof window === "undefined") return "auto";
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
    return "auto";
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // AI Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editInstruction, setEditInstruction] = useState("");
  const [editMessages, setEditMessages] = useState<ChatMessage[]>([]);
  const [editStreamedText, setEditStreamedText] = useState("");
  const [editThinking, setEditThinking] = useState("");
  const [editSearchLogs, setEditSearchLogs] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState("");
  const [editError, setEditError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editPendingCard, setEditPendingCard] = useState<CharacterCardV2 | null>(null);

  const providerWarning = unsupportedMediaWarning(config.provider, referenceMedia);
  const firstReferenceVideo = useMemo(() => referenceMedia.find((item) => item.kind === "video"), [referenceMedia]);
  const activeQuestion = interview?.questions[interview.currentIndex];
  const activeAnswer = interview ? interview.answers[interview.currentIndex] ?? "" : "";

  function setError(message: string, detail = "") {
    setErrorMessage(message);
    setErrorDetail(message ? detail : "");
    setErrorDetailCopied(false);
  }

  useEffect(() => {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as LlmConfig;
        setConfig({
          ...initialConfig,
          ...parsed
        });
      } catch {
        localStorage.removeItem(CONFIG_STORAGE_KEY);
      }
    }

    setHistory(loadHistory());

    // Restore workflow snapshot if present
    const snap = loadWorkflowSnapshot();
    if (snap) {
      setStep(snap.step);
      setPrompt(snap.prompt);
      setMode(snap.mode);
      setAnswers(snap.answers);
      setMessages(snap.messages);
      setCard(snap.card);
      setJsonText(snap.jsonText);
      setInterview(snap.interview);
      setLastCheckpoint(snap.lastCheckpoint);
      setHasGenerated(snap.hasGenerated);
      setHasGeneratedCard(snap.hasGeneratedCard);
      setSearchLogs(snap.searchLogs);
      setThinking(snap.thinking);
      const hint = snap.referenceMediaCount > 0
        ? `（上次附带了 ${snap.referenceMediaCount} 个参考素材，正在恢复...）`
        : "";
      setStatus(`已从自动保存恢复到步骤 ${snap.step + 1}。${hint}`);
    }

    // Restore reference media from IndexedDB
    loadMediaFromStore(MEDIA_STORE_KEY).then((media) => {
      if (media.length > 0) {
        setReferenceMedia(media);
      }
    });
  }, []);

  useEffect(() => {
    const resolved = theme === "auto"
      ? (new Date().getHours() >= 6 && new Date().getHours() < 18 ? "light" : "dark")
      : theme;
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  // Auto-save workflow snapshot (debounced)
  useEffect(() => {
    if (isGenerating) return;
    if (step === 0 && !prompt && messages.length === 0 && !hasGenerated) return;

    const handle = setTimeout(() => {
      const snapshot: WorkflowSnapshot = {
        version: 1,
        savedAt: Date.now(),
        step,
        prompt,
        mode,
        answers,
        messages,
        card,
        jsonText,
        interview,
        lastCheckpoint,
        hasGenerated,
        hasGeneratedCard,
        searchLogs,
        thinking,
        referenceMediaCount: referenceMedia.length,
      };

      try {
        localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // QuotaExceededError: silently fail
      }
    }, 500);

    return () => clearTimeout(handle);
  }, [step, prompt, mode, answers, messages, card, jsonText, interview, lastCheckpoint, hasGenerated, hasGeneratedCard, searchLogs, thinking, referenceMedia.length, isGenerating]);

  // Auto-save reference media to IndexedDB
  useEffect(() => {
    void saveMediaToStore(MEDIA_STORE_KEY, referenceMedia);
  }, [referenceMedia]);

  function updateConfig(patch: Partial<LlmConfig>) {
    setConfig((current) => {
      const next = {
        ...current,
        ...patch
      };

      if (patch.provider) {
        const defaults = providerDefaults[patch.provider];
        next.model = defaults.model;
        next.baseUrl = defaults.baseUrl;
      }

      return next;
    });
  }

  function goToStep(target: number) {
    setStep(Math.min(Math.max(target, 0), TOTAL_STEPS - 1));
  }

  function nextStep() {
    goToStep(step + 1);
  }

  function prevStep() {
    goToStep(step - 1);
  }

  async function handleReferenceUpload(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setError("");
    try {
      const next = await filesToAttachments(files);
      setReferenceMedia((current) => [...current, ...next]);
      setStatus("参考素材已加入。图片会随请求发送；视频只在 Gemini 下发送。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "参考素材读取失败。");
    }
  }

  async function handleAvatarUpload(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setError("");
    try {
      const [nextAvatar] = (await filesToAttachments(files)).filter((item) => item.kind === "image");
      if (!nextAvatar) {
        throw new Error("头像只支持图片。");
      }
      if (cropAvatarUploads) {
        setPendingAvatarCrop({
          original: nextAvatar,
          zoom: 1,
          offsetX: 50,
          offsetY: 50
        });
        setStatus("已读取头像，确认裁剪后再应用。");
        return;
      }
      setAvatarImage(nextAvatar);
      setStatus("头像已设置。头像只用于 PNG 卡片和直链导出，不会作为剧情参考发给 LLM。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "头像读取失败。");
    }
  }

  async function runGenerator(overrides?: {
    answers?: string;
    messages?: ChatMessage[];
  }) {
    setError("");
    setShare(null);

    if (!prompt.trim() && referenceMedia.length === 0) {
      setError("先给我一点描述或上传参考素材，不然 LLM 只能对着空气织毛衣。");
      return;
    }

    const effectiveAnswers = overrides?.answers ?? answers;
    const effectiveMessages = overrides?.messages ?? messages;

    if (!config.apiKey.trim()) {
      const draft = makeLocalDraft({ kind: "character", mode, prompt, language, answers: effectiveAnswers });
      applyLlmResult(draft, "没有填写 API key，已先生成本地草稿。", "draft");
      return;
    }

    setThinking("");
    setSearchLogs([]);
    setStreamedText("");
    setLastCheckpoint(null);
    setIsGenerating(true);
    setStatus(config.directPreferred ? "正在连接 LLM：优先尝试浏览器直连..." : "正在连接 LLM：通过后端临时代理建立连接...");

    const request = {
      config,
      kind: "character" as const,
      mode,
      prompt,
      language,
      answers: effectiveAnswers,
      messages: effectiveMessages,
      media: filterMediaForProvider(config.provider, referenceMedia),
      currentCard: card
    };

    startTransition(async () => {
      let directFailure: LlmErrorInfo | null = null;

      try {
        let result: LlmTurnResult;

        if (config.directPreferred) {
          try {
            result = await sendLlmTurn(request, handleLlmProgress);
            applyLlmResult(result, result.action === "ask_user" ? "已连接 LLM，正在确认关键设定。" : "已连接 LLM，卡片草稿生成完成。", "llm");
            return;
          } catch (directError) {
            directFailure = formatLlmErrorInfo(directError);
            setStatus(`浏览器直连失败，正在改走后端代理继续生成：${directFailure.message}`);
          }
        }

        const proxiedResult = await sendProxiedLlmTurn(request, handleLlmProgress);
        applyLlmResult(proxiedResult, proxiedResult.action === "ask_user" ? "代理已连接 LLM，正在确认关键设定。" : "代理已完成生成，卡片已更新。", "llm");
      } catch (llmError) {
        const failure = formatLlmErrorInfo(llmError);
        setError(failure.message, combineLlmErrorDetails(failure, directFailure));
        setStatus("生成中断。你可以改用 JSON fallback、换模型，或先用本地草稿。");
      } finally {
        setIsGenerating(false);
      }
    });
  }

  function handleLlmProgress(event: LlmProgressEvent) {
    switch (event.type) {
      case "provider_connecting":
        setStatus(event.round > 0 ? "已拿到搜索资料，正在重新请求 LLM 继续生成..." : "正在连接 LLM，请稍等...");
        break;
      case "provider_connected":
        setStatus("LLM 已连接，正在生成内容。页面没有卡住，可以继续等待首段响应。");
        break;
      case "provider_first_byte":
        setStatus("LLM 已经吐出首段响应，正在整理成角色卡...");
        break;
      case "web_search":
        setSearchLogs((current) => [...current, event.query]);
        setStatus(`识别到可搜索角色，正在搜索设定和短语气样例：${event.query}`);
        break;
      case "web_fetch":
        setSearchLogs((current) => [...current, `[fetch] ${event.url}`]);
        setStatus(`正在读取网页内容：${event.url}`);
        break;
      case "token":
        setStreamedText((current) => current + event.text);
        break;
      case "search_progress":
        setLastCheckpoint({ searches: event.searches, messages: event.messages });
        break;
    }
  }

  async function copyCurrentErrorDetail() {
    const text = errorDetail || error;
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setErrorDetailCopied(true);
  }

  function applyLlmResult(result: LlmTurnResult, nextStatus: string, source: HistoryItem["source"] = "llm") {
    setHasGenerated(true);
    setThinking(result.thinking ?? "");
    setSearchLogs(result.searches ?? []);

    if (result.action === "ask_user") {
      setInterview({
        questions: result.questions,
        currentIndex: 0,
        answers: Array.from({ length: result.questions.length }, () => ""),
        customAnswer: ""
      });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.questions.map((item, index) => `${index + 1}. ${item.question}`).join("\n")
        }
      ]);
      setStatus(formatStatus(nextStatus, result.message));
      return;
    }

    const normalized = normalizeCard(result.card, "character");
    setCard(normalized);
    setJsonText(JSON.stringify(normalized, null, 2));
    setHasGeneratedCard(true);
    setIsCurrentCardShareable(isShareableCard(normalized));
    setInterview(null);
    setStep((current) => (current < 3 ? 3 : current));
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: result.message || `已提交 ${result.status === "final" ? "最终" : "草稿"}卡片。`
      }
    ]);
    setStatus(formatStatus(nextStatus, result.message));
  }

  function selectInterviewAnswer(value: string) {
    setInterview((current) => {
      if (!current) {
        return current;
      }

      const question = current.questions[current.currentIndex];
      const answersCopy = [...current.answers];

      if (question?.multiSelect) {
        const existing = answersCopy[current.currentIndex]
          ? answersCopy[current.currentIndex].split("、")
          : [];
        const index = existing.indexOf(value);
        if (index >= 0) {
          existing.splice(index, 1);
        } else {
          existing.push(value);
        }
        answersCopy[current.currentIndex] = existing.join("、");
      } else {
        answersCopy[current.currentIndex] = value;
      }

      return {
        ...current,
        answers: answersCopy,
        customAnswer: ""
      };
    });
  }

  function updateCustomAnswer(value: string) {
    setInterview((current) => current ? { ...current, customAnswer: value } : current);
  }

  function commitCustomAnswer() {
    const custom = interview?.customAnswer.trim();
    if (!custom) {
      return;
    }

    selectInterviewAnswer(custom);
  }

  function moveInterview(delta: number) {
    setInterview((current) => {
      if (!current) {
        return current;
      }

      const nextIndex = Math.min(Math.max(current.currentIndex + delta, 0), current.questions.length - 1);
      return {
        ...current,
        currentIndex: nextIndex,
        customAnswer: ""
      };
    });
  }

  function skipCurrentQuestion() {
    if (!interview) {
      return;
    }

    selectInterviewAnswer("跳过");
    if (interview.currentIndex < interview.questions.length - 1) {
      moveInterview(1);
    } else {
      finishInterview(undefined, true);
    }
  }

  function submitCurrentQuestion() {
    if (!interview) {
      return;
    }

    if (interview.customAnswer.trim()) {
      commitCustomAnswer();
    }

    const nextAnswers = [...interview.answers];
    const committed = interview.customAnswer.trim() || nextAnswers[interview.currentIndex] || "";
    nextAnswers[interview.currentIndex] = committed;

    if (interview.currentIndex < interview.questions.length - 1) {
      setInterview({
        ...interview,
        answers: nextAnswers,
        currentIndex: interview.currentIndex + 1,
        customAnswer: ""
      });
      setStatus(committed ? "已记录这一题，继续下一题。" : "已跳过这一题。");
      return;
    }

    finishInterview(nextAnswers, true);
  }

  function finishInterview(nextAnswers = interview?.answers ?? [], shouldAutoGenerate = false) {
    if (!interview) {
      return;
    }

    const content = interview.questions
      .map((question, index) => `${index + 1}. ${question.question}\n回答：${nextAnswers[index] || "跳过"}`)
      .join("\n\n");

    const nextFullAnswers = [answers, content].filter(Boolean).join("\n\n");
    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content
      }
    ];

    setAnswers(nextFullAnswers);

    if (!content) {
      setStatus("已跳过补充问题，下一轮会让 LLM 直接基于现有信息继续。");
      setInterview(null);
      return;
    }

    setMessages(nextMessages);
    setInterview(null);
    setStatus(shouldAutoGenerate ? "补充已记录，正在继续生成卡片..." : "补充已记录，可以继续生成。");

    if (shouldAutoGenerate) {
      void runGenerator({
        answers: nextFullAnswers,
        messages: nextMessages
      });
    }
  }

  function handleJsonEdit(value: string) {
    setJsonText(value);
    setShare(null);
    try {
      const parsed = normalizeCard(JSON.parse(value), "character");
      setCard(parsed);
      setIsCurrentCardShareable(isShareableCard(parsed));
      setError("");
    } catch (jsonError) {
      setIsCurrentCardShareable(false);
      setError(jsonError instanceof Error ? jsonError.message : "JSON 校验失败。");
    }
  }

  function openEditModal() {
    setEditModalOpen(true);
    setEditInstruction("");
    setEditMessages([]);
    setEditStreamedText("");
    setEditThinking("");
    setEditSearchLogs([]);
    setEditStatus("");
    setEditError("");
    setIsEditing(false);
    setEditPendingCard(null);
  }

  function handleEditProgress(event: LlmProgressEvent) {
    switch (event.type) {
      case "provider_connecting":
        setEditStatus(t.editing);
        break;
      case "provider_connected":
        setEditStatus(t.editing);
        break;
      case "provider_first_byte":
        setEditStatus(t.editing);
        break;
      case "web_search":
        setEditSearchLogs((current) => [...current, event.query]);
        setEditStatus(`搜索中：${event.query}`);
        break;
      case "web_fetch":
        setEditSearchLogs((current) => [...current, `[fetch] ${event.url}`]);
        break;
      case "token":
        setEditStreamedText((current) => current + event.text);
        break;
    }
  }

  async function runEditLlmTurn() {
    if (!editInstruction.trim() || !config.apiKey.trim()) {
      return;
    }

    setEditError("");
    setEditStreamedText("");
    setEditThinking("");
    setEditSearchLogs([]);
    setIsEditing(true);
    setEditStatus(t.editing);
    setEditPendingCard(null);

    const currentEditCard = editPendingCard || card;
    const editMessagesWithInstruction: ChatMessage[] = [
      ...editMessages,
      { role: "user", content: editInstruction }
    ];

    const request = {
      config,
      kind: "character" as const,
      prompt: editInstruction,
      language,
      answers: "",
      messages: editMessagesWithInstruction,
      media: [],
      currentCard: currentEditCard,
      skipInterview: true
    };

    startTransition(async () => {
      try {
        let result: LlmTurnResult;

        if (config.directPreferred) {
          try {
            result = await sendLlmTurn(request, handleEditProgress);
          } catch {
            result = await sendProxiedLlmTurn(request, handleEditProgress);
          }
        } else {
          result = await sendProxiedLlmTurn(request, handleEditProgress);
        }

        if (result.action === "submit_card") {
          const normalized = normalizeCard(result.card, "character");
          setEditPendingCard(normalized);
          setEditThinking(result.thinking ?? "");
          setEditSearchLogs(result.searches ?? []);
          setEditMessages([
            ...editMessagesWithInstruction,
            { role: "assistant", content: result.message || t.editAccepted }
          ]);
          setEditStatus(result.message || t.editAccepted);
          setEditInstruction("");
        } else {
          setEditError("LLM 返回了意外结果，请重试。");
        }
      } catch (err) {
        setEditError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsEditing(false);
      }
    });
  }

  function acceptEdit() {
    if (!editPendingCard) {
      return;
    }

    setCard(editPendingCard);
    setJsonText(JSON.stringify(editPendingCard, null, 2));
    setIsCurrentCardShareable(isShareableCard(editPendingCard));
    setShare(null);
    setEditPendingCard(null);
    setEditModalOpen(false);
    setStatus(t.editAccepted);
  }

  function discardEdit() {
    setEditPendingCard(null);
    setEditStreamedText("");
  }

  async function downloadJson() {
    const filename = `${safeFileName(card.data.name)}.json`;
    downloadBlob(new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }), filename);
  }

  async function downloadPng() {
    try {
      const avatarPng = await getAvatarPngDataUrl();
      const png = embedCardInPngDataUrl(avatarPng, card);
      downloadDataUrl(png, `${safeFileName(card.data.name)}.png`);
    } catch (pngError) {
      setError(pngError instanceof Error ? pngError.message : "PNG 导出失败。");
    }
  }

  function downloadHistoryJson(item: HistoryItem) {
    const cardForDownload = normalizeCard(item.card, "character");
    downloadBlob(
      new Blob([JSON.stringify(cardForDownload, null, 2)], { type: "application/json" }),
      `${safeFileName(cardForDownload.data.name)}.json`
    );
  }

  async function downloadHistoryPng(item: HistoryItem) {
    if (!item.avatarImage) {
      setError("这条历史没有头像，不能下载 PNG。");
      return;
    }

    try {
      const avatarPng = item.avatarImage.mimeType === "image/png" && item.avatarImage.dataUrl.startsWith("data:image/png")
        ? item.avatarImage.dataUrl
        : await convertImageToPngDataUrl(item.avatarImage.dataUrl);
      const cardForDownload = normalizeCard(item.card, "character");
      const png = embedCardInPngDataUrl(avatarPng, cardForDownload);
      downloadDataUrl(png, `${safeFileName(cardForDownload.data.name)}.png`);
    } catch (pngError) {
      setError(pngError instanceof Error ? pngError.message : "PNG 导出失败。");
    }
  }

  async function createShareLink() {
    setError("");
    if (!hasGeneratedCard || !isCurrentCardShareable || !isShareableCard(card)) {
      setShare(null);
      setError("还没有生成有效角色卡，不能创建分享直链。");
      setStatus("先完成生成或手动保存一张有效卡片，再创建直链。");
      return;
    }

    setStatus("正在生成带有效期的直链...");
    try {
      const avatarDataUrl = avatarImage ? await getAvatarPngDataUrl() : undefined;
      const response = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          card,
          avatarDataUrl,
          expiresIn,
          generated: true
        })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "直链生成失败。");
      }

      setShare(json as ShareResponse);
      saveHistoryItem({
        card,
        prompt,
        answers,
        messages,
        avatarImage,
        share: json as ShareResponse,
        source: "manual"
      });
      localStorage.removeItem(WORKFLOW_STORAGE_KEY);
      void clearMediaStore(MEDIA_STORE_KEY);
      setStatus("直链已生成，可以复制导入。");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "直链生成失败。");
      setStatus("直链生成中断。");
    }
  }

  async function copyHistoryShareLink(item: HistoryItem) {
    setError("");
    if (item.share?.url) {
      await navigator.clipboard.writeText(item.share.url);
      setStatus("历史直链已复制。");
      return;
    }

    if (!isShareableCard(item.card)) {
      setError("这条历史还没有有效角色卡，不能创建分享直链。");
      return;
    }

    setHistoryShareBusyId(item.id);
    try {
      const avatarDataUrl = item.avatarImage
        ? item.avatarImage.mimeType === "image/png" && item.avatarImage.dataUrl.startsWith("data:image/png")
          ? item.avatarImage.dataUrl
          : await convertImageToPngDataUrl(item.avatarImage.dataUrl)
        : undefined;
      const response = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          card: item.card,
          avatarDataUrl,
          expiresIn,
          generated: true
        })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "直链生成失败。");
      }

      const nextShare = json as ShareResponse;
      updateHistoryItem(item.id, { share: nextShare });
      await navigator.clipboard.writeText(nextShare.url);
      setStatus("历史直链已生成并复制。");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "直链生成失败。");
    } finally {
      setHistoryShareBusyId(null);
    }
  }

  async function applyPendingAvatarCrop() {
    if (!pendingAvatarCrop) {
      return;
    }

    try {
      const dataUrl = await cropImageToSquare(
        pendingAvatarCrop.original.dataUrl,
        pendingAvatarCrop.zoom,
        pendingAvatarCrop.offsetX,
        pendingAvatarCrop.offsetY
      );
      setAvatarImage({
        ...pendingAvatarCrop.original,
        id: crypto.randomUUID(),
        name: addCroppedSuffix(pendingAvatarCrop.original.name),
        mimeType: "image/png",
        dataUrl,
        size: Math.round((dataUrl.length * 3) / 4)
      });
      setPendingAvatarCrop(null);
      setStatus("已应用 1:1 头像裁剪。");
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "头像裁剪失败。");
    }
  }

  function usePendingAvatarOriginal() {
    if (!pendingAvatarCrop) {
      return;
    }

    setAvatarImage(pendingAvatarCrop.original);
    setPendingAvatarCrop(null);
    setStatus("已使用原图作为头像。");
  }

  async function captureVideoFrame() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 512;
    canvas.height = video.videoHeight || 512;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("浏览器无法创建视频截帧画布。");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    setAvatarImage({
      id: crypto.randomUUID(),
      name: "video-frame-avatar.png",
      mimeType: "image/png",
      kind: "image",
      dataUrl,
      size: Math.round((dataUrl.length * 3) / 4)
    });
    setStatus("已从视频截取一帧作为 PNG 头像。");
  }

  function saveConfig() {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    setStatus("连接配置已保存。现在可以去写灵感，生成时会提示连接与生成进度。");
  }

  function clearSavedConfig() {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
    setConfig({
      ...initialConfig,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: ""
    });
    setStatus("已清除浏览器缓存里的 API 配置。");
  }

  async function fetchModels() {
    if (!config.apiKey.trim()) {
      setError("先填写 API Key 才能获取模型列表。");
      return;
    }

    setError("");
    setModelsLoading(true);
    setAvailableModels(null);
    setStatus("正在获取模型列表...");

    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: config.provider,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl
        })
      });

      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "获取模型列表失败。");
      }

      const models = Array.isArray(data.models) ? data.models as string[] : [];
      setAvailableModels(models);
      setStatus(`已获取 ${models.length} 个模型，可从下拉列表中选择。`);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "获取模型列表失败。");
    } finally {
      setModelsLoading(false);
    }
  }

  function saveCurrentToHistory() {
    saveHistoryItem({
      card,
      prompt,
      answers,
      messages,
      avatarImage,
      share,
      source: "manual"
    });
    setStatus("当前卡片已保存到本地历史。");
  }

  function saveHistoryItem(input: Omit<HistoryItem, "id" | "createdAt">) {
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...input
    };

    setHistory((current) => {
      const next = [item, ...current]
        .filter((entry, index, list) => index === list.findIndex((candidate) => historyKey(candidate) === historyKey(entry)))
        .slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function restoreHistoryItem(item: HistoryItem) {
    const restoredCard = normalizeCard(item.card, "character");
    setCard(restoredCard);
    setJsonText(JSON.stringify(restoredCard, null, 2));
    setHasGenerated(true);
    setHasGeneratedCard(isShareableCard(restoredCard));
    setIsCurrentCardShareable(isShareableCard(restoredCard));
    setPrompt(item.prompt);
    setAnswers(item.answers);
    setMessages(item.messages);
    setAvatarImage(item.avatarImage);
    setShare(null);
    setInterview(null);
    setStatus(`已恢复历史记录：${restoredCard.data.name}`);
  }

  function deleteHistoryItem(id: string) {
    setHistory((current) => {
      const next = current.filter((item) => item.id !== id);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    localStorage.removeItem(WORKFLOW_STORAGE_KEY);
    void clearMediaStore(MEDIA_STORE_KEY);
    setHistory([]);
    setStatus("本地生成历史已清空。");
  }

  function updateHistoryItem(id: string, patch: Partial<HistoryItem>) {
    setHistory((current) => {
      const next = current.map((item) => item.id === id ? { ...item, ...patch } : item);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <p className="eyebrow">DaydreamGenerator</p>
        <h1>{t.masthead}</h1>
        <p className="hero-copy">
          {t.hero}
        </p>
        <button
          className="theme-toggle"
          type="button"
          aria-label={t.themeLabel}
          onClick={() => setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"))}
        >
          {theme === "auto" ? "🕐" : theme === "light" ? "☀️" : "🌙"}
        </button>
      </header>

      <nav className="stepper" aria-label={t.steps[2].title}>
        {t.steps.map((item, index) => {
          const state = index === step ? "active" : index < step ? "done" : "upcoming";
          return (
            <button key={item.title} type="button" className={`step-node ${state}`} onClick={() => goToStep(index)}>
              <span className="step-dot">{index < step ? "✓" : index + 1}</span>
              <span className="step-text">
                <span className="step-title">{item.title}</span>
                <span className="step-caption">{item.caption}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <section className="stage">
        <div className="stage-head">
          <p className="stage-index">Step {step + 1} / {TOTAL_STEPS}</p>
          <h2>{t.steps[step].title}</h2>
          <p className="stage-caption">{t.steps[step].caption}</p>
        </div>

        <div className={`status-bar ${error ? "error" : ""}`}>
          <p className="status-line">{error || status}</p>
          {errorDetail && (
            <details className="error-details">
              <summary>{t.errorDetails}</summary>
              <div className="error-detail-actions">
                <button className="button ghost compact" type="button" onClick={() => void copyCurrentErrorDetail()}>
                  {errorDetailCopied ? t.copiedErrorDetails : t.copyErrorDetails}
                </button>
              </div>
              <pre>{errorDetail}</pre>
            </details>
          )}
        </div>

        <div className="form-grid">
          {step === 0 && (
            <>
            <label className="field">
              <span>{t.language}</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as UiLanguage)}>
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="hint">{t.languageHint}</span>
            </label>

            <label className="field">
              <span>Provider</span>
              <select value={config.provider} onChange={(event) => updateConfig({ provider: event.target.value as ProviderId })}>
                {Object.entries(providerDefaults).map(([value, item]) => (
                  <option key={value} value={value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Model</span>
              <input value={config.model} onChange={(event) => updateConfig({ model: event.target.value })} />
            </label>

            {(config.provider === "openai" || config.provider === "openai-compatible") && (
              <>
                <div className="inline-row">
                  <button
                    className="button ghost"
                    type="button"
                    disabled={modelsLoading}
                    onClick={() => void fetchModels()}
                  >
                    {modelsLoading ? t.fetchingModels : t.fetchModels}
                  </button>
                </div>

                {availableModels && availableModels.length > 0 && (
                  <label className="field">
                    <span>{t.selectModel}</span>
                    <select
                      value={availableModels.includes(config.model) ? config.model : ""}
                      onChange={(event) => {
                        if (event.target.value) {
                          updateConfig({ model: event.target.value });
                        }
                      }}
                    >
                      <option value="" disabled>{availableModels.length} 个模型可用</option>
                      {availableModels.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}

            <label className="field">
              <span>Base URL</span>
              <input value={config.baseUrl ?? ""} onChange={(event) => updateConfig({ baseUrl: event.target.value })} />
            </label>

            <label className="field">
              <span>API Key</span>
              <input
                value={config.apiKey}
                type="password"
                autoComplete="off"
                placeholder="sk-... / AIza... / claude key"
                onChange={(event) => updateConfig({ apiKey: event.target.value })}
              />
            </label>

            <label className="field">
              <span>{t.tavilyLabel}</span>
              <input
                value={config.tavilyKey ?? ""}
                type="password"
                autoComplete="off"
                placeholder={t.tavilyPlaceholder}
                onChange={(event) => updateConfig({ tavilyKey: event.target.value })}
              />
            </label>

            <div className="inline-row">
              <label className="toggle">
                <input
                  checked={config.directPreferred !== false}
                  type="checkbox"
                  onChange={(event) => updateConfig({ directPreferred: event.target.checked })}
                />
                {t.directPreferred}
              </label>
              <label className="toggle">
                <input
                  checked={config.useTools !== false}
                  type="checkbox"
                  onChange={(event) => updateConfig({ useTools: event.target.checked })}
                />
                {t.useTools}
              </label>
            </div>

            <div className="inline-row">
              <button className="button primary" type="button" onClick={saveConfig}>
                {t.saveConfig}
              </button>
              <button className="button ghost" type="button" onClick={clearSavedConfig}>
                {t.clearConfig}
              </button>
            </div>

            <div className={`status-card ${providerWarning ? "warning" : ""}`}>
              <p className="status-line">{providerWarning || t.providerWarningDefault}</p>
            </div>

            <div className="status-card">
              <p className="status-line">
                <strong>{t.directInfoTitle}</strong> {t.directInfoBody}
              </p>
            </div>

            <div className="status-card">
              <p className="status-line">
                <strong>{t.searchInfoTitle}</strong> {t.searchInfoBody}
              </p>
            </div>
            </>
          )}

          {step === 1 && (
            <>
            <div className="field">
              <span>{t.modeLabel}</span>
              <div className="choice-list" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <button
                  className={`choice-button ${mode === "normal" ? "selected" : ""}`}
                  type="button"
                  onClick={() => setMode("normal")}
                >
                  <strong>{t.modeNormal}</strong>
                  <span>{t.modeNormalHint}</span>
                </button>
                <button
                  className={`choice-button ${mode === "story" ? "selected" : ""}`}
                  type="button"
                  onClick={() => setMode("story")}
                >
                  <strong>{t.modeStory}</strong>
                  <span>{t.modeStoryHint}</span>
                </button>
              </div>
            </div>

            <label className="field">
              <span>{t.promptLabel}</span>
              <textarea
                value={prompt}
                placeholder={t.promptPlaceholder}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>

            <label className="field drop-zone">
              <span>{t.referenceLabel}</span>
              <input multiple accept="image/*,video/*" type="file" onChange={(event) => handleReferenceUpload(event.target.files)} />
              <span className="hint">{t.referenceHint}</span>
            </label>

            {referenceMedia.length > 0 && (
              <div className="media-list">
                {referenceMedia.map((item) => (
                  <div className="media-item" key={item.id}>
                    <div className="media-thumb">
                      {item.kind === "image" ? (
                        <img src={item.dataUrl} alt={item.name} />
                      ) : (
                        <video src={item.dataUrl} muted playsInline />
                      )}
                    </div>
                    <div>
                      <p className="media-title">{item.name}</p>
                      <p className="media-meta">{item.kind} · {Math.round(item.size / 1024)}KB · {item.mimeType}</p>
                    </div>
                    <div className="inline-row">
                      <button className="button ghost" type="button" onClick={() => removeMedia(item.id)}>
                        {t.remove}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {firstReferenceVideo && (
              <div className="status-card">
                <p className="status-line">{t.videoFrameHint}</p>
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  src={firstReferenceVideo.dataUrl}
                  style={{ width: "100%", borderRadius: 16, marginTop: 10 }}
                />
                <button className="button amber" type="button" onClick={captureVideoFrame} style={{ marginTop: 10 }}>
                  {t.captureFrame}
                </button>
              </div>
            )}
            </>
          )}

          {step === 2 && (
            <>
            {interview && activeQuestion && (
              <div className="status-card">
                <div className="panel-header">
                  <h3>{t.llmConfirm}</h3>
                  <span className="step-pill">{interview.currentIndex + 1} / {interview.questions.length}</span>
                </div>
                <div className="question-card">
                  <p className="question-title">
                    {activeQuestion.question}
                    {activeQuestion.multiSelect && <span className="multi-select-tag">{t.multiSelect}</span>}
                  </p>
                  <div className="choice-list">
                    {activeQuestion.options.length > 0 ? (
                      activeQuestion.options.map((option) => {
                        const selected = activeQuestion.multiSelect
                          ? activeAnswer.split("、").includes(option.label)
                          : activeAnswer === option.label;
                        return (
                          <button
                            className={`choice-button ${selected ? "selected" : ""}`}
                            key={option.label}
                            type="button"
                            onClick={() => selectInterviewAnswer(option.label)}
                          >
                            <strong>{option.label}</strong>
                            {option.description ? <span>{option.description}</span> : null}
                          </button>
                        );
                      })
                    ) : (
                      <p className="hint">{t.noOptions}</p>
                    )}
                  </div>
                </div>
                <div className="field">
                  <span>{t.customAnswer}</span>
                  <div className="inline-row">
                    <input
                      value={interview.customAnswer}
                      placeholder={t.customPlaceholder}
                      onChange={(event) => updateCustomAnswer(event.target.value)}
                    />
                    <button className="button ghost" type="button" onClick={commitCustomAnswer}>
                      {t.useCustom}
                    </button>
                  </div>
                </div>
                {activeAnswer && (
                  <div className="status-card">
                    <p className="status-line">{t.currentAnswer}{activeAnswer}</p>
                  </div>
                )}
                <div className="inline-row">
                  <button className="button ghost" type="button" disabled={interview.currentIndex === 0} onClick={() => moveInterview(-1)}>
                    {t.prevQuestion}
                  </button>
                  <button className="button primary" type="button" onClick={submitCurrentQuestion}>
                    {interview.currentIndex === interview.questions.length - 1 ? t.finishQuestions : t.nextQuestion}
                  </button>
                  <button className="button ghost" type="button" onClick={skipCurrentQuestion}>
                    {t.skipQuestion}
                  </button>
                </div>
              </div>
            )}

            <div className="inline-row">
              <button className="button primary" type="button" disabled={isGenerating || isPending} onClick={() => void runGenerator()}>
                {isGenerating || isPending ? t.generating : hasGenerated ? t.regenerate : t.startGenerate}
              </button>
              <button className="button ghost" type="button" onClick={() => applyLlmResult(makeLocalDraft({ kind: "character", mode, prompt, language, answers }), t.localDraft, "draft")}>
                {t.localDraft}
              </button>
            </div>

            {!isGenerating && lastCheckpoint && error && (
              <div className="inline-row">
                <button
                  className="button amber"
                  type="button"
                  onClick={() => void runGenerator({ messages: lastCheckpoint.messages })}
                >
                  {t.retryFromCheckpoint}
                </button>
              </div>
            )}

            {streamedText && (
              <div className="status-card">
                <p className="status-line"><strong>{t.streamPreview}</strong></p>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflow: "auto", fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>{streamedText}</pre>
              </div>
            )}

            {thinking && (
              <details className="thinking-panel">
                <summary>{t.thinkingSummary}</summary>
                <p>{thinking}</p>
              </details>
            )}

            {searchLogs.length > 0 && (
              <div className="status-card">
                <p className="status-line"><strong>{t.searchLog}</strong></p>
                {searchLogs.map((query, index) => (
                  <p className="status-line" key={index}>· {query}</p>
                ))}
              </div>
            )}
            </>
          )}

          {step === 3 && (
            <>
            <label className="field drop-zone">
              <span>{t.avatarLabel}</span>
              <input accept="image/*" type="file" onChange={(event) => handleAvatarUpload(event.target.files)} />
              <span className="hint">{t.avatarHint}</span>
            </label>

            <label className="toggle">
              <input
                checked={cropAvatarUploads}
                type="checkbox"
                onChange={(event) => setCropAvatarUploads(event.target.checked)}
              />
              {t.cropToggle}
            </label>

            {pendingAvatarCrop && (
              <div className="crop-panel">
                <div className="panel-header">
                  <h3>{t.cropTitle}</h3>
                  <span className="step-pill">1:1</span>
                </div>
                <div className="crop-preview">
                  <img
                    src={pendingAvatarCrop.original.dataUrl}
                    alt={pendingAvatarCrop.original.name}
                    style={{
                      width: `${pendingAvatarCrop.zoom * 100}%`,
                      height: `${pendingAvatarCrop.zoom * 100}%`,
                      objectPosition: `${pendingAvatarCrop.offsetX}% ${pendingAvatarCrop.offsetY}%`
                    }}
                  />
                </div>
                <label className="field">
                  <span>{t.cropZoom}</span>
                  <input
                    min="1"
                    max="3"
                    step="0.05"
                    type="range"
                    value={pendingAvatarCrop.zoom}
                    onChange={(event) => setPendingAvatarCrop((current) => current ? { ...current, zoom: Number(event.target.value) } : current)}
                  />
                </label>
                <label className="field">
                  <span>{t.cropX}</span>
                  <input
                    min="0"
                    max="100"
                    type="range"
                    value={pendingAvatarCrop.offsetX}
                    onChange={(event) => setPendingAvatarCrop((current) => current ? { ...current, offsetX: Number(event.target.value) } : current)}
                  />
                </label>
                <label className="field">
                  <span>{t.cropY}</span>
                  <input
                    min="0"
                    max="100"
                    type="range"
                    value={pendingAvatarCrop.offsetY}
                    onChange={(event) => setPendingAvatarCrop((current) => current ? { ...current, offsetY: Number(event.target.value) } : current)}
                  />
                </label>
                <div className="inline-row">
                  <button className="button primary" type="button" onClick={() => void applyPendingAvatarCrop()}>
                    {t.applyCrop}
                  </button>
                  <button className="button ghost" type="button" onClick={usePendingAvatarOriginal}>
                    {t.useOriginal}
                  </button>
                  <button className="button ghost" type="button" onClick={() => setPendingAvatarCrop(null)}>
                    {t.cancelCrop}
                  </button>
                </div>
              </div>
            )}

            {avatarImage && (
              <div className="media-item">
                <div className="media-thumb">
                  <img src={avatarImage.dataUrl} alt={avatarImage.name} />
                </div>
                <div>
                  <p className="media-title">{avatarImage.name}</p>
                  <p className="media-meta">avatar · {Math.round(avatarImage.size / 1024)}KB · {avatarImage.mimeType}</p>
                </div>
                <button className="button ghost" type="button" onClick={() => setAvatarImage(null)}>
                  {t.remove}
                </button>
              </div>
            )}

            <label className="field">
              <span>{t.jsonPreview}</span>
              <textarea className="json-editor" spellCheck={false} value={jsonText} onChange={(event) => handleJsonEdit(event.target.value)} />
            </label>

            {hasGeneratedCard && config.apiKey.trim() && (
              <button className="button ghost" type="button" onClick={openEditModal}>
                {t.editWithAi}
              </button>
            )}

            <div className="inline-row">
              <button
                className="button primary"
                type="button"
                onClick={() => {
                  saveHistoryItem({
                    card,
                    prompt,
                    answers,
                    messages,
                    avatarImage,
                    share: null,
                    source: hasGenerated ? "llm" : "manual"
                  });
                  localStorage.removeItem(WORKFLOW_STORAGE_KEY);
                  void clearMediaStore(MEDIA_STORE_KEY);
                  setStatus("已保存到本地历史。");
                  nextStep();
                }}
              >
                {t.saveCard}
              </button>
            </div>
            </>
          )}

          {step === 4 && (
            <>
            <div className="card-preview">
              <div className="avatar-preview">
                {avatarImage ? <img src={avatarImage.dataUrl} alt="avatar preview" /> : null}
              </div>
              <div>
                <h3>{card.data.name}</h3>
                <p>{card.data.description || card.data.scenario || t.noDescription}</p>
              </div>
            </div>

            <div className="status-card">
              <p className="status-line">
                {avatarImage ? t.cardWithAvatar : t.cardWithoutAvatar}
              </p>
            </div>

            <div className="inline-row">
              <button className="button primary" type="button" onClick={downloadJson}>
                {t.downloadJson}
              </button>
              <button className="button amber" type="button" disabled={!avatarImage} onClick={downloadPng}>
                {t.downloadPng}
              </button>
              {config.apiKey.trim() && (
                <button className="button ghost" type="button" onClick={openEditModal}>
                  {t.editWithAi}
                </button>
              )}
            </div>

            <label className="field">
              <span>{t.expiresLabel}</span>
              <select value={expiresIn} onChange={(event) => setExpiresIn(event.target.value as "1h" | "24h" | "7d")}>
                <option value="1h">{t.oneHour}</option>
                <option value="24h">{t.oneDay}</option>
                <option value="7d">{t.sevenDays}</option>
              </select>
            </label>

            <button className="button primary" type="button" disabled={!hasGeneratedCard || !isCurrentCardShareable} onClick={createShareLink}>
              {t.createShare}
            </button>

            <button className="button ghost" type="button" onClick={saveCurrentToHistory}>
              {t.saveHistory}
            </button>

            {share && (
              <div className="share-box">
                <span className="field-label">{share.filename} · {new Date(share.expiresAt).toLocaleString()}</span>
                <a href={share.url} target="_blank" rel="noreferrer">
                  {share.url}
                </a>
                <button className="button ghost" type="button" onClick={() => navigator.clipboard.writeText(share.url)}>
                  {t.copyShare}
                </button>
              </div>
            )}

            </>
          )}
        </div>

        <div className="stage-nav">
          <button className="button ghost" type="button" disabled={step === 0} onClick={prevStep}>
            {t.prevStep}
          </button>
          <span className="stage-nav-hint">{t.steps[step].title} · {step + 1} / {TOTAL_STEPS}</span>
          <button className="button primary" type="button" disabled={step === TOTAL_STEPS - 1} onClick={nextStep}>
            {t.nextStep}
          </button>
        </div>
      </section>

      <section className="history-panel standalone">
        <div className="panel-header">
          <h2>{t.historyTitle}</h2>
          <span className="step-pill">{history.length} / {MAX_HISTORY_ITEMS}</span>
        </div>
        {history.length === 0 ? (
          <p className="hint">{t.historyEmpty}</p>
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <div className="history-item" key={item.id}>
                <div className="history-thumb">
                  {item.avatarImage ? (
                    <img src={item.avatarImage.dataUrl} alt={item.card.data.name} />
                  ) : (
                    <span>{t.noAvatar}</span>
                  )}
                </div>
                <div className="history-main">
                  <p className="media-title">{item.card.data.name}</p>
                  <p className="media-meta">{formatHistoryTime(item.createdAt, language)} · {sourceLabel(item.source, language)}</p>
                  <p className="history-desc">{item.card.data.description || item.card.data.scenario || t.noDescription}</p>
                  {item.share?.url && (
                    <a className="history-share-link" href={item.share.url} target="_blank" rel="noreferrer">
                      {item.share.filename}
                    </a>
                  )}
                </div>
                <div className="history-actions">
                  <button className="button ghost" type="button" onClick={() => restoreHistoryItem(item)}>
                    {t.restore}
                  </button>
                  {config.apiKey.trim() && (
                    <button className="button ghost" type="button" onClick={() => {
                      restoreHistoryItem(item);
                      openEditModal();
                    }}>
                      {t.editWithAi}
                    </button>
                  )}
                  <button className="button ghost" type="button" onClick={() => downloadHistoryJson(item)}>
                    {t.downloadJson}
                  </button>
                  <button className="button ghost" type="button" disabled={!item.avatarImage} onClick={() => void downloadHistoryPng(item)}>
                    {t.downloadPng}
                  </button>
                  <button className="button ghost" type="button" disabled={historyShareBusyId === item.id} onClick={() => void copyHistoryShareLink(item)}>
                    {t.copyShare}
                  </button>
                  <button className="button ghost danger" type="button" onClick={() => deleteHistoryItem(item.id)}>
                    {t.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <button className="button ghost" type="button" onClick={clearHistory}>
            {t.clearHistory}
          </button>
        )}
      </section>

      <p className="footer-note">
        {t.footer}
      </p>

      {editModalOpen && (
        <div className="edit-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setEditModalOpen(false); }}>
          <div className="edit-modal">
            <div className="edit-modal-header">
              <h3>{t.editModalTitle}</h3>
              <button className="button ghost close-edit" type="button" onClick={() => setEditModalOpen(false)}>✕</button>
            </div>

            <div className="edit-card-summary">
              <p><strong>{(editPendingCard || card).data.name}</strong></p>
              <p className="hint">{((editPendingCard || card).data.description || t.noDescription).slice(0, 200)}</p>
            </div>

            {editMessages.length > 0 && (
              <div className="edit-messages">
                {editMessages.map((msg, index) => (
                  <p key={index}><strong>{msg.role === "user" ? "You:" : "AI:"}</strong> {msg.content}</p>
                ))}
              </div>
            )}

            <label className="field">
              <span>{t.editInstructionLabel}</span>
              <textarea
                value={editInstruction}
                placeholder={t.editInstructionPlaceholder}
                disabled={isEditing}
                onChange={(event) => setEditInstruction(event.target.value)}
              />
            </label>

            <div className="inline-row">
              <button className="button primary" type="button" disabled={isEditing || !editInstruction.trim()} onClick={() => void runEditLlmTurn()}>
                {isEditing ? t.editing : t.startEdit}
              </button>
              {editPendingCard && (
                <>
                  <button className="button primary" type="button" onClick={acceptEdit}>{t.acceptEdit}</button>
                  <button className="button ghost" type="button" onClick={discardEdit}>{t.discardEdit}</button>
                </>
              )}
            </div>

            {editStatus && <p className="hint">{editStatus}</p>}
            {editError && <p className="status-line" style={{ color: "var(--rose)" }}>{editError}</p>}

            {editStreamedText && (
              <div className="status-card">
                <pre style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", fontSize: 13 }}>{editStreamedText}</pre>
              </div>
            )}

            {editThinking && (
              <details className="thinking-panel">
                <summary>{t.thinkingSummary}</summary>
                <p>{editThinking}</p>
              </details>
            )}

            {editSearchLogs.length > 0 && (
              <div className="status-card">
                <p className="status-line"><strong>{t.searchLog}</strong></p>
                {editSearchLogs.map((query, index) => (
                  <p className="status-line" key={index}>· {query}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );

  function removeMedia(id: string) {
    setReferenceMedia((current) => current.filter((item) => item.id !== id));
  }

  async function getAvatarPngDataUrl(): Promise<string> {
    if (!avatarImage) {
      throw new Error("没有头像，不能导出 PNG。");
    }

    if (avatarImage.mimeType === "image/png" && avatarImage.dataUrl.startsWith("data:image/png")) {
      return avatarImage.dataUrl;
    }

    return convertImageToPngDataUrl(avatarImage.dataUrl);
  }
}

function filterMediaForProvider(provider: ProviderId, media: MediaAttachment[]): MediaAttachment[] {
  if (provider === "gemini") {
    return media;
  }

  return media.filter((item) => item.kind === "image");
}

async function convertImageToPngDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || 512;
  canvas.height = image.naturalHeight || 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器无法创建 PNG 转换画布。");
  }

  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("头像图片读取失败。"));
    image.src = src;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  downloadUrl(dataUrl, filename);
}

function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function safeFileName(name: string): string {
  return name
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "card";
}

function getInitialLanguage(): UiLanguage {
  if (typeof window === "undefined") {
    return "zh-CN";
  }

  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isUiLanguage(saved) ? saved : "zh-CN";
}

async function cropImageToSquare(dataUrl: string, zoom: number, offsetX: number, offsetY: number): Promise<string> {
  const image = await loadImage(dataUrl);
  const naturalWidth = image.naturalWidth || 512;
  const naturalHeight = image.naturalHeight || 512;
  const side = Math.min(naturalWidth, naturalHeight) / Math.max(zoom, 1);
  const maxX = Math.max(naturalWidth - side, 0);
  const maxY = Math.max(naturalHeight - side, 0);
  const sourceX = maxX * (offsetX / 100);
  const sourceY = maxY * (offsetY / 100);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器无法创建头像裁剪画布。");
  }

  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function addCroppedSuffix(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return `${filename}-1x1.png`;
  }

  return `${filename.slice(0, dot)}-1x1.png`;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeHistoryItem(item))
      .filter((item): item is HistoryItem => Boolean(item))
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    return [];
  }
}

function normalizeHistoryItem(value: unknown): HistoryItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const item = value as Partial<HistoryItem>;
  if (!item.card || typeof item.id !== "string" || typeof item.createdAt !== "number") {
    return null;
  }

  return {
    id: item.id,
    createdAt: item.createdAt,
    card: normalizeCard(item.card, "character"),
    prompt: typeof item.prompt === "string" ? item.prompt : "",
    answers: typeof item.answers === "string" ? item.answers : "",
    messages: Array.isArray(item.messages) ? item.messages.filter(isChatMessage) : [],
    avatarImage: isMediaAttachment(item.avatarImage) ? item.avatarImage : null,
    share: isShareResponse(item.share) ? item.share : null,
    source: item.source === "draft" || item.source === "manual" ? item.source : "llm"
  };
}

function isShareResponse(value: unknown): value is ShareResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const shareValue = value as Partial<ShareResponse>;
  return typeof shareValue.url === "string"
    && typeof shareValue.expiresAt === "number"
    && typeof shareValue.filename === "string"
    && typeof shareValue.contentType === "string";
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const message = value as Partial<ChatMessage>;
  return (message.role === "user" || message.role === "assistant" || message.role === "system")
    && typeof message.content === "string";
}

function isMediaAttachment(value: unknown): value is MediaAttachment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const media = value as Partial<MediaAttachment>;
  return typeof media.id === "string"
    && typeof media.name === "string"
    && typeof media.mimeType === "string"
    && media.kind === "image"
    && typeof media.dataUrl === "string"
    && typeof media.size === "number";
}

function loadWorkflowSnapshot(): WorkflowSnapshot | null {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkflowSnapshot(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(WORKFLOW_STORAGE_KEY);
    return null;
  }
}

function isWorkflowSnapshot(value: unknown): value is WorkflowSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const snap = value as Partial<WorkflowSnapshot>;
  if (snap.version !== 1) return false;
  if (typeof snap.step !== "number" || snap.step < 0 || snap.step >= TOTAL_STEPS) return false;
  if (typeof snap.prompt !== "string") return false;
  if (snap.mode !== "normal" && snap.mode !== "story") return false;
  if (typeof snap.answers !== "string") return false;
  if (!Array.isArray(snap.messages) || !snap.messages.every(isChatMessage)) return false;
  if (!snap.card || typeof snap.card !== "object") return false;
  if (typeof snap.jsonText !== "string") return false;
  if (typeof snap.hasGenerated !== "boolean") return false;
  if (typeof snap.hasGeneratedCard !== "boolean") return false;
  if (!Array.isArray(snap.searchLogs)) return false;
  if (typeof snap.thinking !== "string") return false;
  if (typeof snap.referenceMediaCount !== "number") return false;
  return true;
}

function historyKey(item: HistoryItem): string {
  return `${item.card.data.name}:${item.card.data.description}:${item.card.data.first_mes}`;
}

function sourceLabel(source: HistoryItem["source"], language: UiLanguage): string {
  if (language === "en-US") {
    switch (source) {
      case "draft":
        return "Local draft";
      case "manual":
        return "Manual save";
      default:
        return "LLM";
    }
  }

  if (language === "ja-JP") {
    switch (source) {
      case "draft":
        return "ローカル下書き";
      case "manual":
        return "手動保存";
      default:
        return "LLM 生成";
    }
  }

  switch (source) {
    case "draft":
      return "本地草稿";
    case "manual":
      return "手动保存";
    default:
      return "LLM 生成";
  }
}

function formatStatus(primary: string, detail?: string): string {
  if (!detail) {
    return primary;
  }

  return `${primary} ${detail}`;
}

function formatLlmErrorInfo(error: unknown): LlmErrorInfo {
  if (error instanceof LlmRequestError || error instanceof LlmClientError) {
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

  const text = typeof error === "string" ? error : safeStringify(error);
  return {
    message: text || "LLM 请求失败。",
    detail: text || "LLM 请求失败。"
  };
}

function combineLlmErrorDetails(failure: LlmErrorInfo, directFailure: LlmErrorInfo | null): string {
  if (!directFailure) {
    return failure.detail;
  }

  return [
    `Browser direct attempt failed:\n${directFailure.detail}`,
    `Backend proxy attempt failed:\n${failure.detail}`
  ].join("\n\n---\n\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function sendProxiedLlmTurn(request: {
  config: LlmConfig;
  kind: "character";
  mode?: CardMode;
  prompt: string;
  language: UiLanguage;
  answers: string;
  messages: ChatMessage[];
  media: MediaAttachment[];
  currentCard: CharacterCardV2;
  skipInterview?: boolean;
}, onProgress: (event: LlmProgressEvent) => void): Promise<LlmTurnResult> {
  const response = await fetch("/api/llm", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    const error = isRecord(json) ? json : {};
    throw new LlmClientError(
      String(error.error ?? "LLM 代理请求失败。"),
      String(error.detail ?? error.error ?? safeStringify(json))
    );
  }

  if (!response.body) {
    const json = await response.json();
    return json as LlmTurnResult;
  }

  let finalResult: LlmTurnResult | null = null;
  for await (const streamEvent of readServerEvents(response.body)) {
    if (streamEvent.event === "progress") {
      onProgress(streamEvent.data as LlmProgressEvent);
      continue;
    }

    if (streamEvent.event === "result") {
      finalResult = streamEvent.data as LlmTurnResult;
      continue;
    }

    if (streamEvent.event === "error") {
      const error = isRecord(streamEvent.data) ? streamEvent.data : {};
      throw new LlmClientError(
        String(error.error ?? "LLM 代理请求失败。"),
        String(error.detail ?? error.error ?? safeStringify(streamEvent.data))
      );
    }
  }

  if (!finalResult) {
    throw new Error("LLM 代理没有返回生成结果。");
  }

  return finalResult;
}

async function* readServerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<LlmStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const parsed = parseServerEvent(part);
        if (parsed) {
          yield parsed;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  const parsed = parseServerEvent(buffer);
  if (parsed) {
    yield parsed;
  }
}

function parseServerEvent(raw: string): LlmStreamEvent | null {
  const lines = raw.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  const event = eventLine?.slice("event:".length).trim() || "message";
  if (event !== "progress" && event !== "result" && event !== "error" && event !== "message") {
    return null;
  }

  return {
    event,
    data: JSON.parse(dataLines.join("\n"))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatHistoryTime(value: number, language: UiLanguage): string {
  return new Intl.DateTimeFormat(uiLocale(language), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
