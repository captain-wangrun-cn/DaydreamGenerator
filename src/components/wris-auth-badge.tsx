"use client";

// wris.me 账号徽标：显示当前登录状态，登录/退出都跳 auth.wris.me 统一处理。
// 登录统一跳 auth.wris.me 的选择页（GitHub / Google），选完自动回跳本站。
// 登录态判断走本站 /api/wris/me（服务端验签 .wris.me 共享 Cookie）。
import { useEffect, useState } from "react";

const AUTH_ORIGIN = "https://auth.wris.me";

type WrisUser = { sub: string; provider: string; name: string; login: string; avatar: string | null };

export function WrisAuthBadge() {
  const [user, setUser] = useState<WrisUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/wris/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { user: WrisUser | null }) => setUser(d.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  const zh = typeof document !== "undefined" && document.documentElement.lang.startsWith("zh");
  const backTo = encodeURIComponent(window.location.origin + window.location.pathname);

  if (!user) {
    return (
      <a
        className="wris-badge wris-badge-login"
        href={`${AUTH_ORIGIN}/?redirect_to=${backTo}`}
      >
        {zh ? "登录" : "Sign in"}
      </a>
    );
  }

  return (
    <span className="wris-badge wris-badge-user" title={user.sub}>
      {user.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <span className="wris-badge-name">{user.name || user.login}</span>
      <a href={`${AUTH_ORIGIN}/api/logout?redirect_to=${backTo}`}>
        {zh ? "退出" : "Out"}
      </a>
    </span>
  );
}
