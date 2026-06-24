import { cardJsonSchemaDescription } from "@/lib/llm/prompt";
import type { CardMode } from "@/lib/llm/types";

export function openAiTools(mode?: CardMode) {
  return [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for information about a character, franchise, scenario, cultural reference, quotes, voice lines, catchphrases, or speaking style to improve card accuracy. Use when the user's description references a specific real/searchable character, work, public figure, or event you want to verify.",
        parameters: webSearchParameters()
      }
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch and read the content of a specific URL as markdown text. Use after web_search to read detailed wiki pages, quote pages, or character profiles. Returns up to 2000 characters of page content.",
        parameters: webFetchParameters()
      }
    },
    {
      type: "function",
      function: {
        name: "ask_user",
        description: "Ask the user 1 to 5 concrete follow-up questions with at least 3 selectable options before making the card.",
        parameters: askUserParameters()
      }
    },
    {
      type: "function",
      function: {
        name: "submit_card",
        description: "Submit a draft or final SillyTavern Character Card V2.",
        parameters: submitCardParameters(mode)
      }
    }
  ];
}

export function anthropicTools(mode?: CardMode) {
  return [
    {
      name: "web_search",
      description: "Search the web for information about a character, franchise, scenario, cultural reference, quotes, voice lines, catchphrases, or speaking style to improve card accuracy.",
      input_schema: webSearchParameters()
    },
    {
      name: "web_fetch",
      description: "Fetch and read the content of a specific URL as markdown text. Use after web_search to read detailed wiki pages, quote pages, or character profiles. Returns up to 2000 characters of page content.",
      input_schema: webFetchParameters()
    },
    {
      name: "ask_user",
      description: "Ask the user 1 to 5 concrete follow-up questions with at least 3 selectable options before making the card.",
      input_schema: askUserParameters()
    },
    {
      name: "submit_card",
      description: "Submit a draft or final SillyTavern Character Card V2.",
      input_schema: submitCardParameters(mode)
    }
  ];
}

export function geminiTools(mode?: CardMode) {
  return [
    {
      functionDeclarations: [
        {
          name: "web_search",
          description: "Search the web for information about a character, franchise, scenario, cultural reference, quotes, voice lines, catchphrases, or speaking style to improve card accuracy.",
          parameters: webSearchParameters()
        },
        {
          name: "web_fetch",
          description: "Fetch and read the content of a specific URL as markdown text. Use after web_search to read detailed wiki pages, quote pages, or character profiles. Returns up to 2000 characters of page content.",
          parameters: webFetchParameters()
        },
        {
          name: "ask_user",
          description: "Ask the user 1 to 5 concrete follow-up questions with at least 3 selectable options before making the card.",
          parameters: askUserParameters()
        },
        {
          name: "submit_card",
          description: "Submit a draft or final SillyTavern Character Card V2.",
          parameters: submitCardParameters(mode)
        }
      ]
    }
  ];
}

function webSearchParameters() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "A concise search query to find relevant information."
      }
    },
    required: ["query"]
  };
}

function webFetchParameters() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description: "A full URL to fetch and read the page content as markdown."
      }
    },
    required: ["url"]
  };
}

function askUserParameters() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      message: {
        type: "string",
        description: "Short explanation for why these questions matter."
      },
      thinking: {
        type: "string",
        description: "A concise, user-safe summary of your reasoning, visual observations, search findings, and tradeoffs. Do not include hidden chain-of-thought."
      },
      questions: questionArrayParameters()
    },
    required: ["questions"]
  };
}

function questionArrayParameters() {
  return {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: {
          type: "string",
          description: "A short, concrete question that materially changes the roleplay card."
        },
        multiSelect: {
          type: "boolean",
          description: "Set to true if the user may pick more than one option for this question."
        },
        options: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: {
                type: "string",
                description: "A short selectable answer."
              },
              description: {
                type: "string",
                description: "One short sentence explaining this choice."
              }
            },
            required: ["label"]
          }
        }
      },
      required: ["question", "options"]
    }
  };
}

function submitCardParameters(mode?: CardMode) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["draft", "final"]
      },
      message: {
        type: "string"
      },
      thinking: {
        type: "string",
        description: "A concise, user-safe summary of what you inferred and why this card shape fits. Do not include hidden chain-of-thought."
      },
      card: cardJsonSchemaDescription(mode)
    },
    required: ["status", "card"]
  };
}

export function openAiEditorTools() {
  return openAiTools().filter((tool) => tool.function.name !== "ask_user");
}

export function anthropicEditorTools() {
  return anthropicTools().filter((tool) => tool.name !== "ask_user");
}

export function geminiEditorTools() {
  return geminiTools().map((group) => ({
    functionDeclarations: group.functionDeclarations.filter((tool) => tool.name !== "ask_user")
  }));
}
