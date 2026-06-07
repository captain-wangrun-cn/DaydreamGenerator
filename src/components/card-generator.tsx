"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createEmptyCard, isShareableCard, normalizeCard, type CharacterCardV2 } from "@/lib/card-schema";
import { sendLlmTurn, makeLocalDraft, unsupportedMediaWarning } from "@/lib/llm/providers";
import type { AskQuestion, ChatMessage, LlmConfig, LlmTurnResult, MediaAttachment, ProviderId } from "@/lib/llm/types";
import { filesToAttachments } from "@/lib/media";
import { embedCardInPngDataUrl } from "@/lib/png-card";

const CONFIG_STORAGE_KEY = "daydream-generator.llm-config.v1";
const HISTORY_STORAGE_KEY = "daydream-generator.history.v1";
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

const STEPS = [
  { title: "连接", caption: "选择模型并填写 API key" },
  { title: "灵感", caption: "写下描述、上传参考素材" },
  { title: "生成", caption: "让 LLM 采访并产出卡片" },
  { title: "微调", caption: "设置头像、校对 JSON" },
  { title: "导出", caption: "下载、生成直链、存历史" }
] as const;

const TOTAL_STEPS = STEPS.length;

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
  source: "llm" | "draft" | "manual";
};

export function CardGenerator() {
  const [config, setConfig] = useState<LlmConfig>(initialConfig);
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [referenceMedia, setReferenceMedia] = useState<MediaAttachment[]>([]);
  const [avatarImage, setAvatarImage] = useState<MediaAttachment | null>(null);
  const [card, setCard] = useState<CharacterCardV2>(() => createEmptyCard("character"));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(createEmptyCard("character"), null, 2));
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [status, setStatus] = useState("准备好了。先写一句灵感，我们把它搓成可导入的角色卡。");
  const [error, setError] = useState("");
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expiresIn, setExpiresIn] = useState<"1h" | "24h" | "7d">("24h");
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [hasGenerated, setHasGenerated] = useState(false);
  const [hasGeneratedCard, setHasGeneratedCard] = useState(false);
  const [isCurrentCardShareable, setIsCurrentCardShareable] = useState(false);
  const [searchLogs, setSearchLogs] = useState<string[]>([]);
  const [thinking, setThinking] = useState("");
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => {
    if (typeof window === "undefined") return "auto";
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
    return "auto";
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const providerWarning = unsupportedMediaWarning(config.provider, referenceMedia);
  const firstReferenceVideo = useMemo(() => referenceMedia.find((item) => item.kind === "video"), [referenceMedia]);
  const activeQuestion = interview?.questions[interview.currentIndex];
  const activeAnswer = interview ? interview.answers[interview.currentIndex] ?? "" : "";

  useEffect(() => {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as LlmConfig;
      setConfig({
        ...initialConfig,
        ...parsed
      });
    } catch {
      localStorage.removeItem(CONFIG_STORAGE_KEY);
    }

    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    const resolved = theme === "auto"
      ? (new Date().getHours() >= 6 && new Date().getHours() < 18 ? "light" : "dark")
      : theme;
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem("theme", theme);
  }, [theme]);

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
      const draft = makeLocalDraft({ kind: "character", prompt, answers: effectiveAnswers });
      applyLlmResult(draft, "没有填写 API key，已先生成本地草稿。", "draft");
      return;
    }

    setThinking("");
    setStatus(config.directPreferred ? "生成已开始：正在尝试浏览器直连 LLM..." : "生成已开始：正在通过后端临时代理连接 LLM...");

    const request = {
      config,
      kind: "character" as const,
      prompt,
      answers: effectiveAnswers,
      messages: effectiveMessages,
      media: filterMediaForProvider(config.provider, referenceMedia),
      currentCard: card
    };

    startTransition(async () => {
      try {
        let result: LlmTurnResult;

        if (config.directPreferred) {
          try {
            result = await sendLlmTurn(request);
            applyLlmResult(result, result.action === "ask_user" ? "已连接 LLM，正在确认关键设定。" : "已连接 LLM，卡片草稿生成完成。", "llm");
            return;
          } catch (directError) {
            setStatus(`直连失败，正在走后端临时代理：${directError instanceof Error ? directError.message : "未知错误"}`);
          }
        }

        const response = await fetch("/api/llm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(request)
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error ?? "LLM 代理请求失败。");
        }

        const proxiedResult = json as LlmTurnResult;
        applyLlmResult(proxiedResult, proxiedResult.action === "ask_user" ? "代理已连接 LLM，正在确认关键设定。" : "代理已完成生成，卡片已更新。", "llm");
      } catch (llmError) {
        setError(llmError instanceof Error ? llmError.message : "LLM 请求失败。");
        setStatus("生成中断。你可以改用 JSON fallback、换模型，或先用本地草稿。");
      }
    });
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
    saveHistoryItem({
      card: normalized,
      prompt,
      answers,
      messages,
      avatarImage,
      source
    });
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
    const committed = interview.customAnswer.trim() || nextAnswers[interview.currentIndex];
    nextAnswers[interview.currentIndex] = committed;

    if (!committed) {
      setStatus("请先选择一个答案，或写一个自定义回答。");
      return;
    }

    if (interview.currentIndex < interview.questions.length - 1) {
      setInterview({
        ...interview,
        answers: nextAnswers,
        currentIndex: interview.currentIndex + 1,
        customAnswer: ""
      });
      setStatus("已记录这一题，继续下一题。");
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
      setStatus("直链已生成，可以复制导入。");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "直链生成失败。");
      setStatus("直链生成中断。");
    }
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

  function saveCurrentToHistory() {
    saveHistoryItem({
      card,
      prompt,
      answers,
      messages,
      avatarImage,
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
    setHistory([]);
    setStatus("本地生成历史已清空。");
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <p className="eyebrow">DaydreamGenerator</p>
        <h1>把白日梦，装进角色卡。</h1>
        <p className="hero-copy">
          一句话灵感 · 一键生成角色卡 · JSON / PNG 多格式导出
        </p>
        <button
          className="theme-toggle"
          type="button"
          aria-label="切换主题：自动 / 浅色 / 深色"
          onClick={() => setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"))}
        >
          {theme === "auto" ? "🕐" : theme === "light" ? "☀️" : "🌙"}
        </button>
      </header>

      <nav className="stepper" aria-label="生成步骤">
        {STEPS.map((item, index) => {
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
          <h2>{STEPS[step].title}</h2>
          <p className="stage-caption">{STEPS[step].caption}</p>
        </div>

        <div className={`status-bar ${error ? "error" : ""}`}>
          <p className="status-line">{error || status}</p>
        </div>

        <div className="form-grid">
          {step === 0 && (
            <>
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
              <span>Tavily API Key（可选，启用搜索）</span>
              <input
                value={config.tavilyKey ?? ""}
                type="password"
                autoComplete="off"
                placeholder="tvly-... · 服务端已配置则无需填写"
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
                浏览器直连优先
              </label>
              <label className="toggle">
                <input
                  checked={config.useTools !== false}
                  type="checkbox"
                  onChange={(event) => updateConfig({ useTools: event.target.checked })}
                />
                使用 tool call
              </label>
            </div>

            <div className="inline-row">
              <button className="button primary" type="button" onClick={saveConfig}>
                保存连接配置
              </button>
              <button className="button ghost" type="button" onClick={clearSavedConfig}>
                清除缓存配置
              </button>
            </div>

            <div className={`status-card ${providerWarning ? "warning" : ""}`}>
              <p className="status-line">{providerWarning || "参考图片会作为多模态输入发送；参考视频仅 Gemini 模式发送。头像不会发送给 LLM。"}</p>
            </div>

            <div className="status-card">
              <p className="status-line">
                <strong>直连优先，代理兜底。</strong> API key 只有点击保存连接时才进入浏览器缓存；CORS 或上传限制导致直连失败时，才会把本次 key 临时发给后端转发。
              </p>
            </div>

            <div className="status-card">
              <p className="status-line">
                <strong>网络搜索。</strong> 填写 Tavily API Key 后，LLM 可在生成过程中搜索互联网补充角色背景。服务端若已配置 TAVILY_API_KEY 则无需客户端填写。
              </p>
            </div>
            </>
          )}

          {step === 1 && (
            <>
            <label className="field">
              <span>自由描述</span>
              <textarea
                value={prompt}
                placeholder="例如：参考截图里是一个 X 帖子的暧昧吵架场景，我想让 AI 扮演发帖人，继续和我对话。"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>

            <label className="field drop-zone">
              <span>参考素材：截图 / 图片 / 视频</span>
              <input multiple accept="image/*,video/*" type="file" onChange={(event) => handleReferenceUpload(event.target.files)} />
              <span className="hint">参考素材用于让 LLM 理解场景和人物关系。图片 8MB，视频 24MB；视频仅 Gemini 会读取。</span>
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
                        移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {firstReferenceVideo && (
              <div className="status-card">
                <p className="status-line">如果参考视频里有适合的画面，也可以播放到某一帧并截为卡片头像。</p>
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  src={firstReferenceVideo.dataUrl}
                  style={{ width: "100%", borderRadius: 16, marginTop: 10 }}
                />
                <button className="button amber" type="button" onClick={captureVideoFrame} style={{ marginTop: 10 }}>
                  截取当前帧为头像
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
                  <h3>LLM 想确认</h3>
                  <span className="step-pill">{interview.currentIndex + 1} / {interview.questions.length}</span>
                </div>
                <div className="question-card">
                  <p className="question-title">
                    {activeQuestion.question}
                    {activeQuestion.multiSelect && <span className="multi-select-tag">可多选</span>}
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
                      <p className="hint">这个模型没有提供候选项，可以直接写自定义回答。</p>
                    )}
                  </div>
                </div>
                <div className="field">
                  <span>自定义回答</span>
                  <div className="inline-row">
                    <input
                      value={interview.customAnswer}
                      placeholder="写一个更准确的答案，然后点使用自定义"
                      onChange={(event) => updateCustomAnswer(event.target.value)}
                    />
                    <button className="button ghost" type="button" onClick={commitCustomAnswer}>
                      使用自定义
                    </button>
                  </div>
                </div>
                {activeAnswer && (
                  <div className="status-card">
                    <p className="status-line">当前答案：{activeAnswer}</p>
                  </div>
                )}
                <div className="inline-row">
                  <button className="button ghost" type="button" disabled={interview.currentIndex === 0} onClick={() => moveInterview(-1)}>
                    上一题
                  </button>
                  <button className="button primary" type="button" onClick={submitCurrentQuestion}>
                    {interview.currentIndex === interview.questions.length - 1 ? "完成问答" : "下一题"}
                  </button>
                  <button className="button ghost" type="button" onClick={skipCurrentQuestion}>
                    跳过本题
                  </button>
                </div>
              </div>
            )}

            <div className="inline-row">
              <button className="button primary" type="button" disabled={isPending} onClick={() => void runGenerator()}>
                {isPending ? "正在连接并生成..." : hasGenerated ? "重新生成角色卡" : "连接 LLM 并开始生成"}
              </button>
              <button className="button ghost" type="button" onClick={() => applyLlmResult(makeLocalDraft({ kind: "character", prompt, answers }), "已生成本地草稿。", "draft")}>
                本地草稿
              </button>
            </div>

            {thinking && (
              <details className="thinking-panel">
                <summary>查看模型思考摘要</summary>
                <p>{thinking}</p>
              </details>
            )}

            {searchLogs.length > 0 && (
              <div className="status-card">
                <p className="status-line"><strong>网络搜索记录</strong></p>
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
              <span>卡片头像：仅图片</span>
              <input accept="image/*" type="file" onChange={(event) => handleAvatarUpload(event.target.files)} />
              <span className="hint">头像只用于 PNG 卡片和 PNG 直链，不会作为参考素材发送给 LLM。没有头像时会导出 JSON。</span>
            </label>

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
                  移除头像
                </button>
              </div>
            )}

            <label className="field">
              <span>结构化卡片 JSON 预览 / 手动编辑</span>
              <textarea className="json-editor" spellCheck={false} value={jsonText} onChange={(event) => handleJsonEdit(event.target.value)} />
            </label>
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
                <p>{card.data.description || card.data.scenario || "还没有描述。生成或手动编辑后会显示在这里。"}</p>
              </div>
            </div>

            <div className="status-card">
              <p className="status-line">
                {avatarImage ? "检测到卡片头像：可导出 PNG 角色卡，也可生成 PNG 直链。" : "未设置卡片头像：默认导出 JSON 和 JSON 直链。"}
              </p>
            </div>

            <div className="inline-row">
              <button className="button primary" type="button" onClick={downloadJson}>
                下载 JSON
              </button>
              <button className="button amber" type="button" disabled={!avatarImage} onClick={downloadPng}>
                下载 PNG
              </button>
            </div>

            <label className="field">
              <span>直链有效期</span>
              <select value={expiresIn} onChange={(event) => setExpiresIn(event.target.value as "1h" | "24h" | "7d")}>
                <option value="1h">1 小时</option>
                <option value="24h">24 小时</option>
                <option value="7d">7 天</option>
              </select>
            </label>

            <button className="button primary" type="button" disabled={!hasGeneratedCard || !isCurrentCardShareable} onClick={createShareLink}>
              生成有效期直链
            </button>

            <button className="button ghost" type="button" onClick={saveCurrentToHistory}>
              保存到本地历史
            </button>

            {share && (
              <div className="share-box">
                <span className="field-label">{share.filename} · {new Date(share.expiresAt).toLocaleString()}</span>
                <a href={share.url} target="_blank" rel="noreferrer">
                  {share.url}
                </a>
                <button className="button ghost" type="button" onClick={() => navigator.clipboard.writeText(share.url)}>
                  复制直链
                </button>
              </div>
            )}

            <div className="history-panel">
              <div className="panel-header">
                <h3>本地历史</h3>
                <span className="step-pill">{history.length} / {MAX_HISTORY_ITEMS}</span>
              </div>
              {history.length === 0 ? (
                <p className="hint">生成成功后会自动保存到这里，也可以手动保存当前卡片。</p>
              ) : (
                <div className="history-list">
                  {history.map((item) => (
                    <div className="history-item" key={item.id}>
                      <div className="history-thumb">
                        {item.avatarImage ? <img src={item.avatarImage.dataUrl} alt={item.card.data.name} /> : null}
                      </div>
                      <div>
                        <p className="media-title">{item.card.data.name}</p>
                        <p className="media-meta">{formatHistoryTime(item.createdAt)} · {sourceLabel(item.source)}</p>
                        <p className="history-desc">{item.card.data.description || item.card.data.scenario || "无描述"}</p>
                      </div>
                      <div className="history-actions">
                        <button className="button ghost" type="button" onClick={() => restoreHistoryItem(item)}>
                          恢复
                        </button>
                        <button className="button ghost" type="button" onClick={() => deleteHistoryItem(item.id)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {history.length > 0 && (
                <button className="button ghost" type="button" onClick={clearHistory}>
                  清空历史
                </button>
              )}
            </div>
            </>
          )}
        </div>

        <div className="stage-nav">
          <button className="button ghost" type="button" disabled={step === 0} onClick={prevStep}>
            上一步
          </button>
          <span className="stage-nav-hint">{STEPS[step].title} · {step + 1} / {TOTAL_STEPS}</span>
          <button className="button primary" type="button" disabled={step === TOTAL_STEPS - 1} onClick={nextStep}>
            下一步
          </button>
        </div>
      </section>

      <p className="footer-note">
        提醒：参考素材用于生成语义，头像用于导出文件。浏览器缓存 key 适合个人工具；如果公开部署给别人使用，请让每个用户填写自己的 key。
      </p>
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
    source: item.source === "draft" || item.source === "manual" ? item.source : "llm"
  };
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

function historyKey(item: HistoryItem): string {
  return `${item.card.data.name}:${item.card.data.description}:${item.card.data.first_mes}`;
}

function sourceLabel(source: HistoryItem["source"]): string {
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

function formatHistoryTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
