import type { CardKind, CharacterCardV2 } from "@/lib/card-schema";
import type { ChatMessage, MediaAttachment } from "@/lib/llm/types";

export const generatorSystemPrompt = `
你是一个 SillyTavern Character Card V2 制卡助手。你要把用户的自由描述、参考图片或参考视频转成可导入的角色卡。

目标：
1. 第一次交互时，你必须先使用 ask_user 提出 1 到 3 个具体问题，确认关键设定。不要跳过提问直接提交卡片。每个问题必须带 2 到 4 个候选项（可标记 multiSelect: true 允许多选），用户也可以自定义回答。问题要短，优先询问会明显改变角色表现的设定。
2. 收到用户的问题回答后，再提交 Character Card V2 JSON。不要输出 Markdown。
3. 参考媒体可能是截图、帖子文案、漫画分镜、短视频或情境画面。你要理解其中的场景、关系、张力和可扮演对象，并生成适合继续对话的角色卡。
4. description 写外貌/身份/背景，personality 写行为模式与说话风格，scenario 写用户进入对话时的当前情境，first_mes 写自然开场白。
5. 不要生成空泛套话；保留用户给出的风格、禁忌、世界观、关系张力。头像图片不代表剧情参考，除非用户在文字里明确说明。

网络搜索规则：
- 如果你识别到角色来自真实存在的作品（动漫、游戏、小说、影视、VTuber、公众人物等），或者用户明确提示这是真实角色，你必须先调用 web_search 搜索该角色的官方设定、性格、关系和背景信息，再进行制卡。
- 搜索时用角色名 + 作品名作为关键词，优先使用该角色最广为人知的语言（如日本作品用日文名/英文名）。
- 搜索结果中的设定细节（外貌、口癖、关系、经历）应当融入卡片，而非只用你的记忆。
- 如果搜索没有可用结果，继续用已有信息生成，不要因为搜索失败而中断。
`.trim();

export const fallbackJsonInstruction = `
如果当前 API 不支持 tool call，你必须只返回严格 JSON，格式二选一：
{"action":"ask_user","message":"简短说明","thinking":"可选：面向用户的简短推理摘要，不要写隐藏思维链","questions":[{"question":"问题1","options":[{"label":"选项A","description":"简短影响说明"},{"label":"选项B","description":"简短影响说明"}]}]}
{"action":"submit_card","status":"draft","message":"简短说明","thinking":"可选：面向用户的简短推理摘要，不要写隐藏思维链","card":{"spec":"chara_card_v2","spec_version":"2.0","data":{...}}}
`.trim();

export function buildUserPrompt(input: {
  kind: CardKind;
  prompt: string;
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

  return `
用户原始描述：
${input.prompt || "无"}

用户补充回答：
${input.answers || "无"}

已发生的采访对话：
${conversation}

参考媒体（用于理解截图/帖子/视频情境，不是卡片头像）：
${mediaSummary}

当前草稿：
${input.currentCard ? JSON.stringify(input.currentCard, null, 2) : "无"}

请决定下一步：继续提问，或提交 draft/final 卡片。
`.trim();
}

export function cardJsonSchemaDescription() {
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
          first_mes: { type: "string" },
          mes_example: { type: "string" },
          creator_notes: { type: "string" },
          system_prompt: { type: "string" },
          post_history_instructions: { type: "string" },
          alternate_greetings: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          creator: { type: "string" },
          character_version: { type: "string" },
          extensions: { type: "object" }
        },
        required: ["name"]
      }
    },
    required: ["spec", "spec_version", "data"]
  };
}
