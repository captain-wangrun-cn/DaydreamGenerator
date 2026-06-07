import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/share/route";
import { normalizeCard } from "@/lib/card-schema";

describe("share route guardrails", () => {
  it("rejects requests that were not produced by generation", async () => {
    const response = await POST(new Request("http://localhost/api/share", {
      method: "POST",
      body: JSON.stringify({
        card: normalizeCard({
          name: "星港店主",
          description: "会在凌晨开门的旧星港店主。"
        }, "character"),
        expiresIn: "24h"
      })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "还没有生成东西，不能创建分享直链。"
    });
  });

  it("rejects empty default cards before checking share credentials", async () => {
    const response = await POST(new Request("http://localhost/api/share", {
      method: "POST",
      body: JSON.stringify({
        card: normalizeCard({ name: "未命名角色" }, "character"),
        expiresIn: "24h",
        generated: true
      })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "还没有生成有效角色卡，不能创建分享直链。"
    });
  });
});
