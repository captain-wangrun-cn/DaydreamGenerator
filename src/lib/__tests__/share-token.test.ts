import { describe, expect, it } from "vitest";
import { signShareToken, verifyShareToken } from "@/lib/share-token";

describe("share token", () => {
  it("round trips signed payloads", async () => {
    const secret = "a-long-enough-test-secret";
    const token = await signShareToken({
      pathname: "shares/test.json",
      filename: "test.json",
      contentType: "application/json",
      expiresAt: Date.now() + 1000
    }, secret);

    const payload = await verifyShareToken(token, secret);
    expect(payload.pathname).toBe("shares/test.json");
  });

  it("rejects expired links", async () => {
    const secret = "a-long-enough-test-secret";
    const token = await signShareToken({
      pathname: "shares/test.json",
      filename: "test.json",
      contentType: "application/json",
      expiresAt: 10
    }, secret);

    await expect(verifyShareToken(token, secret, 20)).rejects.toThrow("Share link expired");
  });
});
