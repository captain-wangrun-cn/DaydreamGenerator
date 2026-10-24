// wris.me 中央认证：本地验签 auth.wris.me 签发的会话 JWT（EdDSA / Ed25519）。
// 公钥来自环境变量 WRIS_AUTH_PUBLIC_KEY（PEM 格式，换行可写作 \n）。
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const PUBLIC_KEY = process.env.WRIS_AUTH_PUBLIC_KEY
  ? createPublicKey(process.env.WRIS_AUTH_PUBLIC_KEY.replace(/\\n/g, "\n"))
  : null;

export type WrisUser = {
  /** 稳定用户 ID，如 "github:123456"，可作为数据里的用户主键 */
  sub: string;
  provider: string;
  name: string;
  login: string;
  avatar: string | null;
};

/** 从请求的 Cookie 头解析当前登录用户；未登录 / 会话过期 / 未配置公钥返回 null */
export function getWrisUser(cookieHeader: string | undefined | null): WrisUser | null {
  if (!cookieHeader || !PUBLIC_KEY) return null;

  const token = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("wris_session="))
    ?.slice("wris_session=".length);
  if (!token) return null;

  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;

  const ok = cryptoVerify(null, Buffer.from(`${h}.${p}`), PUBLIC_KEY, Buffer.from(s, "base64url"));
  if (!ok) return null;

  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims as WrisUser;
  } catch {
    return null;
  }
}
