import { z } from "zod";

export const cardKindSchema = z.literal("character");
export type CardKind = z.infer<typeof cardKindSchema>;

const stringArray = z.array(z.string()).default([]);

export const characterCardDataSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  description: z.string().default(""),
  personality: z.string().default(""),
  scenario: z.string().default(""),
  first_mes: z.string().default(""),
  mes_example: z.string().default(""),
  creator_notes: z.string().default(""),
  system_prompt: z.string().default(""),
  post_history_instructions: z.string().default(""),
  alternate_greetings: stringArray,
  tags: stringArray,
  creator: z.string().default("Daydream Generator"),
  character_version: z.string().default("1.0"),
  extensions: z
    .record(z.string(), z.unknown())
    .default({})
});

export const characterCardV2Schema = z.object({
  spec: z.literal("chara_card_v2"),
  spec_version: z.literal("2.0"),
  data: characterCardDataSchema
});

export type CharacterCardData = z.infer<typeof characterCardDataSchema>;
export type CharacterCardV2 = z.infer<typeof characterCardV2Schema>;

export type CardDraftInput = Partial<CharacterCardData> & {
  kind?: CardKind;
};

export function createEmptyCard(_kind: CardKind = "character"): CharacterCardV2 {
  return normalizeCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "未命名角色",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "Daydream Generator",
      character_version: "1.0",
      extensions: {}
    }
  });
}

export function normalizeCard(input: unknown, kind: CardKind = "character"): CharacterCardV2 {
  const parsed = characterCardV2Schema.partial({
    spec: true,
    spec_version: true
  }).safeParse(input);

  if (!parsed.success) {
    const dataOnly = characterCardDataSchema.partial().parse(input);
    return normalizeCardData(dataOnly, kind);
  }

  const data = characterCardDataSchema.partial().parse(parsed.data.data ?? {});
  return normalizeCardData(data, kind);
}

export function normalizeCardData(input: CardDraftInput, kind: CardKind = "character"): CharacterCardV2 {
  const safeKind = input.kind ?? kind;
  const base = createCardDataDefaults(safeKind);
  const mergedExtensions = {
    ...base.extensions,
    ...(input.extensions ?? {})
  };

  return characterCardV2Schema.parse({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      ...base,
      ...input,
      name: input.name?.trim() || base.name,
      alternate_greetings: toStringArray(input.alternate_greetings),
      tags: dedupe([
        ...base.tags,
        ...toStringArray(input.tags)
      ]),
      extensions: mergedExtensions
    }
  });
}

function createCardDataDefaults(kind: CardKind): CharacterCardData {
  return {
    name: "未命名角色",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "Daydream Generator",
    character_version: "1.0",
    extensions: {
      daydreamgenerator: {
        source: "daydream-generator",
        format: "character-card-v2"
      }
    }
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
