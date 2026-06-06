export type ShareTokenPayload = {
  pathname: string;
  filename: string;
  contentType: "application/json" | "image/png";
  expiresAt: number;
};

export async function signShareToken(payload: ShareTokenPayload, secret: string): Promise<string> {
  if (!secret || secret.length < 16) {
    throw new Error("SHARE_SECRET must be at least 16 characters.");
  }

  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmac(body, secret);
  return `${body}.${signature}`;
}

export async function verifyShareToken(token: string, secret: string, now = Date.now()): Promise<ShareTokenPayload> {
  const [body, signature] = token.split(".");

  if (!body || !signature) {
    throw new Error("Invalid share token.");
  }

  const expected = await hmac(body, secret);
  if (!timingSafeEqual(signature, expected)) {
    throw new Error("Invalid share token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(body)) as ShareTokenPayload;
  if (payload.expiresAt <= now) {
    const error = new Error("Share link expired.");
    error.name = "ExpiredShareToken";
    throw error;
  }

  return payload;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function hmac(value: string, secret: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return Buffer.from(signature).toString("base64url");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.subtle
    ? leftBuffer.every((byte, index) => byte === rightBuffer[index])
    : left === right;
}
