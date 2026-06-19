import type { UiLanguage } from "@/lib/llm/types";

export type LanguageOption = {
  value: UiLanguage;
  label: string;
  locale: string;
};

export type AppStrings = {
  steps: Array<{ title: string; caption: string }>;
  ready: string;
  masthead: string;
  hero: string;
  language: string;
  languageHint: string;
  themeLabel: string;
  tavilyLabel: string;
  tavilyPlaceholder: string;
  providerWarningDefault: string;
  directInfoTitle: string;
  directInfoBody: string;
  searchInfoTitle: string;
  searchInfoBody: string;
  saveConfig: string;
  clearConfig: string;
  directPreferred: string;
  useTools: string;
  promptLabel: string;
  promptPlaceholder: string;
  referenceLabel: string;
  referenceHint: string;
  videoFrameHint: string;
  captureFrame: string;
  remove: string;
  avatarLabel: string;
  avatarHint: string;
  cropToggle: string;
  cropTitle: string;
  cropZoom: string;
  cropX: string;
  cropY: string;
  applyCrop: string;
  useOriginal: string;
  cancelCrop: string;
  jsonPreview: string;
  llmConfirm: string;
  multiSelect: string;
  noOptions: string;
  customAnswer: string;
  customPlaceholder: string;
  useCustom: string;
  currentAnswer: string;
  prevQuestion: string;
  nextQuestion: string;
  finishQuestions: string;
  skipQuestion: string;
  startGenerate: string;
  regenerate: string;
  generating: string;
  errorDetails: string;
  copyErrorDetails: string;
  copiedErrorDetails: string;
  localDraft: string;
  thinkingSummary: string;
  searchLog: string;
  downloadJson: string;
  downloadPng: string;
  expiresLabel: string;
  createShare: string;
  saveHistory: string;
  copyShare: string;
  historyTitle: string;
  historyEmpty: string;
  restore: string;
  delete: string;
  clearHistory: string;
  noAvatar: string;
  noDescription: string;
  cardWithAvatar: string;
  cardWithoutAvatar: string;
  oneHour: string;
  oneDay: string;
  sevenDays: string;
  prevStep: string;
  nextStep: string;
  footer: string;
  saveCard: string;
  streamPreview: string;
  retryFromCheckpoint: string;
  fetchModels: string;
  fetchingModels: string;
  selectModel: string;
};

export const languageOptions: LanguageOption[] = [
  { value: "zh-CN", label: "简体中文", locale: "zh-CN" },
  { value: "en-US", label: "English", locale: "en-US" },
  { value: "ja-JP", label: "日本語", locale: "ja-JP" }
];

export const copy: Record<UiLanguage, AppStrings> = {
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
    errorDetails: "完整错误信息",
    copyErrorDetails: "复制错误",
    copiedErrorDetails: "错误信息已复制。",
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
    footer: "提醒：参考素材用于生成语义，头像用于导出文件。浏览器缓存 key 适合个人工具；如果公开部署给别人使用，请让每个用户填写自己的 key。",
    saveCard: "保存",
    streamPreview: "AI 实时输出",
    retryFromCheckpoint: "从搜索进度重试",
    fetchModels: "获取模型列表",
    fetchingModels: "正在获取模型...",
    selectModel: "选择模型"
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
    errorDetails: "Full error details",
    copyErrorDetails: "Copy error",
    copiedErrorDetails: "Error details copied.",
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
    footer: "Note: references are used for generation context; avatar is used for exported files. Browser-cached keys are best for personal tools.",
    saveCard: "Save",
    streamPreview: "AI live output",
    retryFromCheckpoint: "Retry from checkpoint",
    fetchModels: "Fetch models",
    fetchingModels: "Fetching models...",
    selectModel: "Select model"
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
    errorDetails: "完全なエラー情報",
    copyErrorDetails: "エラーをコピー",
    copiedErrorDetails: "エラー情報をコピーしました。",
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
    footer: "注意：参考素材は生成文脈に、头像は出力ファイルに使います。ブラウザ保存 key は個人利用向きです。",
    saveCard: "保存",
    streamPreview: "AI リアルタイム出力",
    retryFromCheckpoint: "チェックポイントから再試行",
    fetchModels: "モデル一覧を取得",
    fetchingModels: "モデル取得中...",
    selectModel: "モデルを選択"
  }
};

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh-CN" || value === "en-US" || value === "ja-JP";
}

export function uiLocale(language: UiLanguage): string {
  return languageOptions.find((option) => option.value === language)?.locale ?? "zh-CN";
}
