import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const provider = body.provider as string;
    const apiKey = body.apiKey as string;
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required." }, { status: 400 });
    }

    if (provider !== "openai" && provider !== "openai-compatible") {
      return NextResponse.json({ error: "Model listing is only supported for OpenAI and OpenAI-compatible providers." }, { status: 400 });
    }

    const modelsUrl = provider === "openai"
      ? "https://api.openai.com/v1/models"
      : `${(baseUrl || "").replace(/\/+$/, "")}/models`;

    const response = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Failed to fetch models: ${response.status} ${response.statusText}`, detail: text },
        { status: 502 }
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const models = extractModelIds(data);

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error fetching models.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractModelIds(data: Record<string, unknown>): string[] {
  if (!Array.isArray(data.data)) {
    return [];
  }

  return data.data
    .map((item: unknown) => {
      if (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).id === "string") {
        return (item as Record<string, unknown>).id as string;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id))
    .sort();
}
