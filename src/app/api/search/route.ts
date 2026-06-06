import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TavilyResult = {
  title: string;
  url: string;
  content: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const clientKey = typeof body.tavilyKey === "string" ? body.tavilyKey.trim() : "";

    if (!query) {
      return NextResponse.json({ error: "Missing search query." }, { status: 400 });
    }

    const apiKey = process.env.TAVILY_API_KEY || clientKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "No Tavily API key available. Set TAVILY_API_KEY on server or provide tavilyKey in config." },
        { status: 400 }
      );
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Tavily search failed: ${response.status} ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await response.json()) as TavilyResponse;
    const results = (data.results ?? []).slice(0, 5).map((item) => ({
      title: item.title || "",
      url: item.url || "",
      content: (item.content || "").slice(0, 500)
    }));

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search request failed." },
      { status: 500 }
    );
  }
}
