import type { CardKind, CharacterCardV2 } from "@/lib/card-schema";
import type { CardMode, ChatMessage, MediaAttachment, UiLanguage } from "@/lib/llm/types";

const baseSystemPrompt = `
你是一个 SillyTavern Character Card V2 制卡助手。你要把用户的自由描述、参考图片或参考视频转成可导入的角色卡。

硬性规则：没有完成至少一轮 ask_user 问答前，不允许 submit_card，不允许直接生成卡片并结束本轮。
参考媒体可能是截图、帖子文案、漫画分镜、短视频或情境画面。你要理解其中的场景、关系、张力和可扮演对象，并生成适合继续对话的角色卡。
description 写外貌/身份/背景，personality 写行为模式与说话风格，scenario 写用户进入对话时的当前情境，first_mes 写自然开场白。
first_mes 格式要求：动作描写和心理活动用斜体（*动作* 或 _动作_），对话用英文双引号包裹（"对话内容"），叙述和对话之间换行分隔，适当换行保证每段不会太长。不要出现大段无格式纯文字。
不要生成空泛套话；保留用户给出的风格、禁忌、世界观、关系张力。头像图片不代表剧情参考，除非用户在文字里明确说明。
严格输出格式：使用 tool call 或 fallback JSON 时，你的回复必须且只能包含工具调用或 JSON 对象本身。绝对不要在 JSON 前后输出任何解释、说明、Markdown 标记或其他文字。不要用 \`\`\`json \`\`\` 包裹 JSON。直接输出纯净的 JSON 对象。
`.trim();

const normalModePrompt = `
目标：
1. 第一次交互时，你必须先使用 ask_user 提出 1 到 5 个具体问题，确认关键设定。不要跳过提问直接提交卡片。每个问题必须带 3 到 5 个候选项（可标记 multiSelect: true 允许多选），用户也可以自定义回答。问题要短，优先询问会明显改变角色表现的设定。
2. 收到用户的问题回答后，再提交 Character Card V2 JSON。不要输出 Markdown。
`.trim();

const storyModePrompt = `
你当前处于「剧情模式」。用户希望你生成一个带有完整剧情结构的角色卡，而不仅仅是一个对话角色。

目标：
1. 第一次交互时，你必须先使用 ask_user 提出 3 到 5 个具体问题，深入了解故事需求。问题应涵盖：故事主题与基调、世界观设定、主角（用户扮演对象）与核心角色的关系、期望的幕/章节结构、关键冲突与转折点、可选的分支走向。每个问题必须带 3 到 5 个候选项（可标记 multiSelect: true 允许多选），用户也可以自定义回答。
2. 收到用户回答后，你应当再进行 1 到 2 轮补充提问（继续使用 ask_user），确认遗漏的剧情要素，例如：高潮场景、结局走向、每幕的核心事件。剧情模式鼓励更充分的采访，不要急于提交。
3. 至少完成 2 轮 ask_user 问答后，才可以提交卡片。
4. 提交卡片时，你必须按以下规则填充各字段：
   - scenario = 世界观概述 + 故事大纲摘要
   - alternate_greetings = 每个 greeting 对应一幕/一章的开场白，用于 SillyTavern 的 alternate greetings 切换章节
   - system_prompt = 剧情推进指令，告诉后续 LLM 如何在对话中推动剧情发展、维持节奏和张力
   - post_history_instructions = 动态剧情引导，根据当前进展提示 LLM 如何调整对话方向
   - creator_notes = 完整故事梗概，供用户参考
   - extensions.daydreamgenerator.story = 结构化剧情元数据（见下方 schema）
5. extensions.daydreamgenerator.story 的 JSON 结构：
{
  "mode": "story",
  "theme": "故事主题，如：复仇与救赎",
  "structure": "结构类型，如：三幕式、五幕式、线性章节",
  "acts": [
    {
      "title": "第一幕：标题",
      "summary": "本幕摘要",
      "key_events": ["事件1", "事件2"],
      "greeting_index": 0
    }
  ],
  "branching_points": [
    {
      "description": "分支描述",
      "options": ["选项A方向", "选项B方向"]
    }
  ]
}
greeting_index 指向 alternate_greetings 数组中对应幕的索引。
branching_points 列出故事中用户可能影响走向的关键决策点。
`.trim();

const webSearchRules = `
网络搜索规则：
- 如果你识别到角色来自真实存在且可以搜索到的作品/人物（动漫、游戏、小说、影视、VTuber、公众人物等），或者用户明确提示这是真实角色，你必须先调用 web_search 搜索该角色的官方设定、性格、关系和背景信息，再进行制卡。搜索后如果发现有值得深入阅读的页面（如 Wiki、角色百科、语录页面），可以用 web_fetch 抓取该页面的详细内容。
- 搜索时用角色名 + 作品名作为关键词，优先使用该角色最广为人知的语言（如日本作品用日文名/英文名）。如果第一轮结果能确认角色存在，还要优先搜索"角色名 + quotes/lines/voice lines/语录/台词/口癖/セリフ"等短语气样例。
- 搜索结果中的设定细节（外貌、口癖、关系、经历）应当融入卡片，而非只用你的记忆。
- 对可搜索角色，personality 必须写清说话节奏、常用称呼、口癖、情绪表达方式和互动边界；mes_example 必须加入 2 到 4 组原创示例对话来模仿语气。在 personality 末尾追加一个「经典语录」段落（以 [经典语录] 开头），逐句列出 5 到 10 条从搜索结果中提取的角色原话或标志性台词，帮助后续模型精确模仿口吻。每条语录单独一行，用引号标注，简要注明出处场景。
- 如果搜索到的资料存在矛盾，以官方资料、作品 Wiki、百科和可靠资料优先；不确定之处写入 creator_notes，避免把猜测当事实。
- 如果搜索没有可用结果，继续用已有信息推进，但仍必须遵守先 ask_user 再 submit_card 的规则。
`.trim();

export function generatorSystemPrompt(mode?: CardMode): string {
  const modeSection = mode === "story" ? storyModePrompt : normalModePrompt;
  return `${baseSystemPrompt}\n\n${modeSection}\n\n${webSearchRules}`;
}

export const fallbackJsonInstruction = `
如果当前 API 不支持 tool call，你必须只返回严格 JSON，格式三选一：
{"action":"web_search","query":"搜索关键词"}
{"action":"web_fetch","url":"https://example.com/page"}
{"action":"ask_user","message":"简短说明","thinking":"可选：面向用户的简短推理摘要，不要写隐藏思维链","questions":[{"question":"问题1","options":[{"label":"选项A","description":"简短影响说明"},{"label":"选项B","description":"简短影响说明"},{"label":"选项C","description":"简短影响说明"}]}]}
{"action":"submit_card","status":"draft","message":"简短说明","thinking":"可选：面向用户的简短推理摘要，不要写隐藏思维链","card":{"spec":"chara_card_v2","spec_version":"2.0","data":{...}}}
没有完成至少一轮 ask_user 问答前，只能返回 ask_user 或 web_search 或 web_fetch，不能返回 submit_card。
严格要求：你的回复必须且只能是一个 JSON 对象。禁止在 JSON 前后输出任何解释、问候、Markdown 标记（如 \`\`\`json）、思考过程或其他文字。直接以 { 开头，以 } 结尾。
`.trim();

export function buildUserPrompt(input: {
  kind: CardKind;
  mode?: CardMode;
  prompt: string;
  language?: UiLanguage;
  answers: string;
  messages: ChatMessage[];
  media: MediaAttachment[];
  currentCard?: CharacterCardV2;
}) {
  const mediaSummary = input.media
    .map((item) => `- ${item.kind}: ${item.name} (${item.mimeType}, ${Math.round(item.size / 1024)}KB)`)
    .join("\n") || "无";

  const conversation = input.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n") || "无";
  const languageLabel = languageName(input.language ?? "zh-CN");
  const modeLabel = input.mode === "story" ? "剧情角色卡片（剧情模式）" : "普通角色卡片";

  return `
用户原始描述：
${input.prompt || "无"}

界面与首句语言：
${languageLabel}

当前模式：
${modeLabel}

用户补充回答：
${input.answers || "无"}

已发生的采访对话：
${conversation}

参考媒体（用于理解截图/帖子/视频情境，不是卡片头像）：
${mediaSummary}

当前草稿：
${input.currentCard ? JSON.stringify(input.currentCard, null, 2) : "无"}

请决定下一步：如果还没有看到用户补充回答或已完成的采访对话，必须继续提问；只有完成至少一轮问答后，才可以提交 draft/final 卡片。提交卡片时，first_mes 必须使用"界面与首句语言"指定的语言自然书写，用 *斜体* 或 _斜体_ 描写动作和心理，对话用英文双引号包裹，段落间换行，每段不要太长。
如果用户描述的对象是真实存在且可搜索到的角色/人物，提交卡片前必须确认已经搜索过设定资料；能搜到语录/台词/口癖时，要在 personality 末尾用 [经典语录] 段落逐句列出 5 到 10 条角色原话或标志性台词（引号标注，注明场景），把原创示例对话写入 mes_example，帮助后续模型模仿口吻。
`.trim();
}

function languageName(language: UiLanguage): string {
  switch (language) {
    case "en-US":
      return "English";
    case "ja-JP":
      return "日本語";
    default:
      return "简体中文";
  }
}

export function cardJsonSchemaDescription(mode?: CardMode) {
  const extensionSchema = mode === "story"
    ? {
        type: "object" as const,
        properties: {
          daydreamgenerator: {
            type: "object" as const,
            properties: {
              source: { type: "string" as const },
              format: { type: "string" as const },
              story: {
                type: "object" as const,
                properties: {
                  mode: { type: "string" as const, const: "story" },
                  theme: { type: "string" as const },
                  structure: { type: "string" as const },
                  acts: {
                    type: "array" as const,
                    items: {
                      type: "object" as const,
                      properties: {
                        title: { type: "string" as const },
                        summary: { type: "string" as const },
                        key_events: { type: "array" as const, items: { type: "string" as const } },
                        greeting_index: { type: "integer" as const }
                      },
                      required: ["title", "summary", "key_events", "greeting_index"]
                    }
                  },
                  branching_points: {
                    type: "array" as const,
                    items: {
                      type: "object" as const,
                      properties: {
                        description: { type: "string" as const },
                        options: { type: "array" as const, items: { type: "string" as const } }
                      },
                      required: ["description", "options"]
                    }
                  }
                },
                required: ["mode", "theme", "structure", "acts"]
              }
            }
          }
        }
      }
    : { type: "object" as const };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      spec: { type: "string", const: "chara_card_v2" },
      spec_version: { type: "string", const: "2.0" },
      data: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          personality: { type: "string" },
          scenario: { type: "string" },
          first_mes: { type: "string", description: "Opening message. Use *italics* or _italics_ for actions/thoughts, \"double quotes\" for dialogue, with line breaks between sections. Keep each paragraph short." },
          mes_example: { type: "string" },
          creator_notes: { type: "string" },
          system_prompt: { type: "string" },
          post_history_instructions: { type: "string" },
          alternate_greetings: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          creator: { type: "string" },
          character_version: { type: "string" },
          extensions: extensionSchema
        },
        required: ["name"]
      }
    },
    required: ["spec", "spec_version", "data"]
  };
}
