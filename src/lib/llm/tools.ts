import { cardJsonSchemaDescription } from "@/lib/llm/prompt";

export function openAiTools() {
  return [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for information about a character, franchise, scenario, or cultural reference to improve card accuracy. Use when the user's description references a specific work, character, or event you want to verify.",
        parameters: webSearchParameters()
      }
    },
    {
      type: "function",
      function: {
        name: "ask_user",
        description: "Ask the user 1 to 3 concrete follow-up questions with at least 3 selectable options before making the card.",
        parameters: askUserParameters()
      }
    },
    {
      type: "function",
      function: {
        name: "submit_card",
        description: "Submit a draft or final SillyTavern Character Card V2.",
        parameters: submitCardParameters()
      }
    }
  ];
}

export function anthropicTools() {
  return [
    {
      name: "web_search",
      description: "Search the web for information about a character, franchise, scenario, or cultural reference to improve card accuracy.",
      input_schema: webSearchParameters()
    },
    {
      name: "ask_user",
      description: "Ask the user 1 to 3 concrete follow-up questions with at least 3 selectable options before making the card.",
      input_schema: askUserParameters()
    },
    {
      name: "submit_card",
      description: "Submit a draft or final SillyTavern Character Card V2.",
      input_schema: submitCardParameters()
    }
  ];
}

export function geminiTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "web_search",
          description: "Search the web for information about a character, franchise, scenario, or cultural reference to improve card accuracy.",
          parameters: webSearchParameters()
        },
        {
          name: "ask_user",
          description: "Ask the user 1 to 3 concrete follow-up questions with at least 3 selectable options before making the card.",
          parameters: askUserParameters()
        },
        {
          name: "submit_card",
          description: "Submit a draft or final SillyTavern Character Card V2.",
          parameters: submitCardParameters()
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
    maxItems: 3,
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
          maxItems: 4,
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

function submitCardParameters() {
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
      card: cardJsonSchemaDescription()
    },
    required: ["status", "card"]
  };
}
