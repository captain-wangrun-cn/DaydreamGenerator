"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createEmptyCard, isShareableCard, normalizeCard, type CharacterCardV2 } from "@/lib/card-schema";
import { sendLlmTurn, makeLocalDraft, unsupportedMediaWarning } from "@/lib/llm/providers";
import type { AskQuestion, ChatMessage, LlmConfig, LlmTurnResult, MediaAttachment, ProviderId, UiLanguage } from "@/lib/llm/types";
import { filesToAttachments } from "@/lib/media";
import { embedCardInPngDataUrl } from "@/lib/png-card";

const CONFIG_STORAGE_KEY = "daydream-generator.llm-config.v1";
const HISTORY_STORAGE_KEY = "daydream-generator.history.v1";
const LANGUAGE_STORAGE_KEY = "daydream-generator.language.v1";
const MAX_HISTORY_ITEMS = 30;

const languageOptions: Array<{ value: UiLanguage; label: string; locale: string }> = [
  { value: "zh-CN", label: "简体中文", locale: "zh-CN" },
  { value: "en-US", label: "English", locale: "en-US" },
  { value: "ja-JP", label: "日本語", locale: "ja-JP" }
];

const copy = {
  "zh-CN": {
    steps: [
      { title: "连接", caption: "选择模型并填写 API key" },
      { title: "灵感", caption: "写下描述、上传参考素材" },
      { title: "生成", caption: "让 LLM 采访并产出卡片" },
      { title: "微调", caption: "设置头像、校对 JSON" },
      { title: "导出", caption: "下载、生成直链、存历史" }
    ],
    ready: "准备好了。先写一句灵感，我们把它搓成可导入的角色卡。",
    masthead: "把白日梦，装进角色卡。",
    hero: "一句话灵感 · 一键生成角色卡 · JSON / PNG 多格式导出",
    language: "语言",
    languageHint: "影响网页界面，以及生成角色卡 first_mes 的语言。",
    themeLabel: "切换主题：自动 / 浅色 / 深色",
    tavilyLabel: "Tavily API Key（可选，启用搜索）",
    tavilyPlaceholder: "tvly-... · 服务端已配置则无需填写",
    providerWarningDefault: "参考图片会作为多模态输入发送；参考视频仅 Gemini 模式发送。头像不会发送给 LLM。",
    directInfoTitle: "直连优先，代理兜底。",
    directInfoBody: "API key 只有点击保存连接时才进入浏览器缓存；CORS 或上传限制导致直连失败时，才会把本次 key 临时发给后端转发。",
    searchInfoTitle: "网络搜索。",
    searchInfoBody: "填写 Tavily API Key 后，LLM 可在生成过程中搜索互联网补充角色背景。服务端若已配置 TAVILY_API_KEY 则无需客户端填写。",
    saveConfig: "保存连接配置",
    clearConfig: "清除缓存配置",
    directPreferred: "浏览器直连优先",
    useTools: "使用 tool call",
    promptLabel: "自由描述",
    promptPlaceholder: "例如：参考截图里是一个 X 帖子的暧昧吵架场景，我想让 AI 扮演发帖人，继续和我对话。",
    referenceLabel: "参考素材：截图 / 图片 / 视频",
    referenceHint: "参考素材用于让 LLM 理解场景和人物关系。图片 8MB，视频 24MB；视频仅 Gemini 会读取。",
    videoFrameHint: "如果参考视频里有适合的画面，也可以播放到某一帧并截为卡片头像。",
    captureFrame: "截取当前帧为头像",
    remove: "移除",
    avatarLabel: "卡片头像：仅图片",
    avatarHint: "头像只用于 PNG 卡片和 PNG 直链，不会作为参考素材发送给 LLM。没有头像时会导出 JSON。",
    cropToggle: "上传后裁剪为 1:1",
    cropTitle: "裁剪头像",
    cropZoom: "缩放",
    cropX: "水平位置",
    cropY: "垂直位置",
    applyCrop: "应用 1:1 裁剪",
    useOriginal: "使用原图",
    cancelCrop: "取消",
    jsonPreview: "结构化卡片 JSON 预览 / 手动编辑",
    llmConfirm: "LLM 想确认",
    multiSelect: "可多选",
    noOptions: "这个模型没有提供候选项，可以直接写自定义回答。",
    customAnswer: "自定义回答",
    customPlaceholder: "写一个更准确的答案，然后点使用自定义",
    useCustom: "使用自定义",
    currentAnswer: "当前答案：",
    prevQuestion: "上一题",
    nextQuestion: "下一题",
    finishQuestions: "完成问答",
    skipQuestion: "跳过本题",
    startGenerate: "连接 LLM 并开始生成",
    regenerate: "重新生成角色卡",
    generating: "正在连接并生成...",
    localDraft: "本地草稿",
    thinkingSummary: "查看模型思考摘要",
    searchLog: "网络搜索记录",
    downloadJson: "下载 JSON",
    downloadPng: "下载 PNG",
    expiresLabel: "直链有效期",
    createShare: "生成有效期直链",
    saveHistory: "保存到本地历史",
    copyShare: "复制直链",
    historyTitle: "本地历史",
    historyEmpty: "生成成功后会自动保存到这里，也可以手动保存当前卡片。",
    restore: "恢复",
    delete: "删除",
    clearHistory: "清空历史",
    noAvatar: "无头像",
    noDescription: "无描述",
    cardWithAvatar: "检测到卡片头像：可导出 PNG 角色卡，也可生成 PNG 直链。",
    cardWithoutAvatar: "未设置卡片头像：默认导出 JSON 和 JSON 直链。",
    oneHour: "1 小时",
    oneDay: "24 小时",
    sevenDays: "7 天",
    prevStep: "上一步",
    nextStep: "下一步",
    footer: "提醒：参考素材用于生成语义，头像用于导出文件。浏览器缓存 key 适合个人工具；如果公开部署给别人使用，请让每个用户填写自己的 key。"
  },
  "en-US": {
    steps: [
      { title: "Connect", caption: "Choose a model and API key" },
      { title: "Idea", caption: "Describe the card and add references" },
      { title: "Generate", caption: "Let the LLM ask and draft" },
      { title: "Refine", caption: "Set avatar and review JSON" },
      { title: "Export", caption: "Download, share, and save" }
    ],
    ready: "Ready. Write one idea and we will turn it into an importable character card.",
    masthead: "Turn daydreams into character cards.",
    hero: "One-line ideas · Guided generation · JSON / PNG export",
    language: "Language",
    languageHint: "Changes the page UI and the generated card's first_mes language.",
    themeLabel: "Switch theme: auto / light / dark",
    tavilyLabel: "Tavily API Key (optional, enables search)",
    tavilyPlaceholder: "tvly-... · leave blank if configured on the server",
    providerWarningDefault: "Reference images are sent as multimodal input. Reference videos are sent only with Gemini. Avatars are never sent to the LLM.",
    directInfoTitle: "Direct first, proxy fallback.",
    directInfoBody: "The API key is cached in the browser only when you save connection settings. If CORS or upload limits block direct calls, this key is sent temporarily through the backend proxy for that request.",
    searchInfoTitle: "Web search.",
    searchInfoBody: "After you add a Tavily API key, the LLM can search the web during generation. If TAVILY_API_KEY is configured on the server, the client key is optional.",
    saveConfig: "Save connection",
    clearConfig: "Clear saved key",
    directPreferred: "Prefer browser direct",
    useTools: "Use tool calls",
    promptLabel: "Freeform description",
    promptPlaceholder: "Example: the screenshot is a tense flirtatious argument. I want the AI to roleplay as the poster and continue with me.",
    referenceLabel: "References: screenshots / images / videos",
    referenceHint: "References help the LLM understand scene and relationships. Images 8MB, videos 24MB; videos are sent only with Gemini.",
    videoFrameHint: "If a video has a good frame, play to that moment and capture it as the card avatar.",
    captureFrame: "Capture current frame",
    remove: "Remove",
    avatarLabel: "Card avatar: image only",
    avatarHint: "Avatar is only used for PNG cards and share links. It is not sent to the LLM as reference material.",
    cropToggle: "Crop upload to 1:1",
    cropTitle: "Crop avatar",
    cropZoom: "Zoom",
    cropX: "Horizontal",
    cropY: "Vertical",
    applyCrop: "Apply 1:1 crop",
    useOriginal: "Use original",
    cancelCrop: "Cancel",
    jsonPreview: "Structured card JSON preview / manual edit",
    llmConfirm: "LLM wants to confirm",
    multiSelect: "Multi-select",
    noOptions: "This model did not provide options. You can write a custom answer.",
    customAnswer: "Custom answer",
    customPlaceholder: "Write a more accurate answer, then use it",
    useCustom: "Use custom",
    currentAnswer: "Current answer: ",
    prevQuestion: "Previous",
    nextQuestion: "Next",
    finishQuestions: "Finish",
    skipQuestion: "Skip",
    startGenerate: "Connect LLM and generate",
    regenerate: "Regenerate card",
    generating: "Connecting and generating...",
    localDraft: "Local draft",
    thinkingSummary: "View model summary",
    searchLog: "Search log",
    downloadJson: "Download JSON",
    downloadPng: "Download PNG",
    expiresLabel: "Share link expiry",
    createShare: "Create expiring share link",
    saveHistory: "Save to local history",
    copyShare: "Copy share link",
    historyTitle: "Local history",
    historyEmpty: "Successful generations are saved here. You can also save the current card manually.",
    restore: "Restore",
    delete: "Delete",
    clearHistory: "Clear history",
    noAvatar: "No avatar",
    noDescription: "No description",
    cardWithAvatar: "Avatar detected: you can export a PNG card or create a PNG share link.",
    cardWithoutAvatar: "No avatar set: JSON download and JSON share links are used by default.",
    oneHour: "1 hour",
    oneDay: "24 hours",
    sevenDays: "7 days",
    prevStep: "Previous",
    nextStep: "Next",
    footer: "Note: references are used for generation context; avatar is used for exported files. Browser-cached keys are best for personal tools."
  },
  "ja-JP": {
    steps: [
      { title: "接続", caption: "モデルと API key を設定" },
      { title: "アイデア", caption: "説明を書き、参考素材を追加" },
      { title: "生成", caption: "LLM が質問してカードを作成" },
      { title: "調整", caption: "头像と JSON を確認" },
      { title: "出力", caption: "下载、共有、履歴保存" }
    ],
    ready: "準備完了です。ひとことのアイデアから、インポート可能なキャラクターカードにします。",
    masthead: "白昼夢を、キャラクターカードへ。",
    hero: "ひとことアイデア · ガイド付き生成 · JSON / PNG 出力",
    language: "言語",
    languageHint: "ページ表示と、生成カードの first_mes の言語に反映されます。",
    themeLabel: "テーマ切替：自動 / ライト / ダーク",
    tavilyLabel: "Tavily API Key（任意、検索を有効化）",
    tavilyPlaceholder: "tvly-... · サーバー設定済みなら空欄で可",
    providerWarningDefault: "参考画像はマルチモーダル入力として送信されます。参考動画は Gemini のみ送信します。头像は LLM に送信しません。",
    directInfoTitle: "直結優先、プロキシで補助。",
    directInfoBody: "API key は接続設定を保存した時だけブラウザに保存されます。CORS やアップロード制限で直結できない場合のみ、そのリクエストで一時的にバックエンドへ送ります。",
    searchInfoTitle: "Web 検索。",
    searchInfoBody: "Tavily API Key を入力すると、生成中に LLM が Web 検索で背景情報を補えます。サーバーに TAVILY_API_KEY がある場合、クライアント側入力は不要です。",
    saveConfig: "接続設定を保存",
    clearConfig: "保存キーを削除",
    directPreferred: "ブラウザ直結を優先",
    useTools: "tool call を使用",
    promptLabel: "自由記述",
    promptPlaceholder: "例：スクショは少し甘く緊張感のある口論です。AI には投稿者として続きを演じてほしい。",
    referenceLabel: "参考素材：スクショ / 画像 / 動画",
    referenceHint: "参考素材は場面や関係性の理解に使います。画像 8MB、動画 24MB。動画は Gemini のみ送信します。",
    videoFrameHint: "参考動画に良い場面があれば、そのフレームをカード头像として切り出せます。",
    captureFrame: "現在フレームを头像にする",
    remove: "削除",
    avatarLabel: "カード头像：画像のみ",
    avatarHint: "头像は PNG カードと共有リンクだけに使います。参考素材として LLM には送りません。",
    cropToggle: "アップロード後 1:1 に裁剪",
    cropTitle: "头像を裁剪",
    cropZoom: "拡大",
    cropX: "水平位置",
    cropY: "垂直位置",
    applyCrop: "1:1 裁剪を適用",
    useOriginal: "原图を使う",
    cancelCrop: "取消",
    jsonPreview: "構造化カード JSON プレビュー / 手動編集",
    llmConfirm: "LLM の確認",
    multiSelect: "複数選択",
    noOptions: "このモデルは候補を出しませんでした。自由回答を書けます。",
    customAnswer: "自由回答",
    customPlaceholder: "より正確な回答を書いてから使用",
    useCustom: "自由回答を使う",
    currentAnswer: "現在の回答：",
    prevQuestion: "前へ",
    nextQuestion: "次へ",
    finishQuestions: "問答を完了",
    skipQuestion: "この質問を飛ばす",
    startGenerate: "LLM に接続して生成",
    regenerate: "カードを再生成",
    generating: "接続して生成中...",
    localDraft: "ローカル下書き",
    thinkingSummary: "モデル要約を見る",
    searchLog: "検索履歴",
    downloadJson: "JSON 下载",
    downloadPng: "PNG 下载",
    expiresLabel: "共有リンク期限",
    createShare: "期限付き共有リンクを生成",
    saveHistory: "履歴に保存",
    copyShare: "共有リンクをコピー",
    historyTitle: "ローカル履歴",
    historyEmpty: "生成成功後ここに保存されます。現在のカードも手動保存できます。",
    restore: "復元",
    delete: "削除",
    clearHistory: "履歴を空にする",
    noAvatar: "头像なし",
    noDescription: "説明なし",
    cardWithAvatar: "カード头像があります：PNG カード出力と PNG 共有リンクを使えます。",
    cardWithoutAvatar: "カード头像がありません：既定では JSON 出力と JSON 共有リンクを使います。",
    oneHour: "1 時間",
    oneDay: "24 時間",
    sevenDays: "7 日",
    prevStep: "前へ",
    nextStep: "次へ",
    footer: "注意：参考素材は生成文脈に、头像は出力ファイルに使います。ブラウザ保存 key は個人利用向きです。"
  }
};

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

export function CardGenerator() {
  const [language, setLanguage] = useState<UiLanguage>(() => getInitialLanguage());
  const t = copy[language];
  const [config, setConfig] = useState<LlmConfig>(initialConfig);
  const [prompt, setPrompt] = useState("");
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
  const [error, setError] = useState("");
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [historyShareBusyId, setHistoryShareBusyId] = useState<string | null>(null);
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

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

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
      const draft = makeLocalDraft({ kind: "character", prompt, language, answers: effectiveAnswers });
      applyLlmResult(draft, "没有填写 API key，已先生成本地草稿。", "draft");
      return;
    }

    setThinking("");
    setStatus(config.directPreferred ? "生成已开始：正在尝试浏览器直连 LLM..." : "生成已开始：正在通过后端临时代理连接 LLM...");

    const request = {
      config,
      kind: "character" as const,
      prompt,
      language,
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
      share: null,
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
              <button className="button primary" type="button" disabled={isPending} onClick={() => void runGenerator()}>
                {isPending ? t.generating : hasGenerated ? t.regenerate : t.startGenerate}
              </button>
              <button className="button ghost" type="button" onClick={() => applyLlmResult(makeLocalDraft({ kind: "character", prompt, language, answers }), t.localDraft, "draft")}>
                {t.localDraft}
              </button>
            </div>

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

function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh-CN" || value === "en-US" || value === "ja-JP";
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

function formatHistoryTime(value: number, language: UiLanguage): string {
  const locale = languageOptions.find((option) => option.value === language)?.locale ?? "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
