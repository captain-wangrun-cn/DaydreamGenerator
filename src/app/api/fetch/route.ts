import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json({ error: "Missing URL." }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
    }

    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers: Record<string, string> = {
      Accept: "text/markdown"
    };

    const jinaKey = process.env.JINA_API_KEY;
    if (jinaKey) {
      headers["Authorization"] = `Bearer ${jinaKey}`;
    }

    const response = await fetch(jinaUrl, {
      headers,
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Fetch failed: ${response.status} ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const text = await response.text();
    const truncated = text.slice(0, 2000);

    return NextResponse.json({ url, content: truncated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fetch request failed." },
      { status: 500 }
    );
  }
}
