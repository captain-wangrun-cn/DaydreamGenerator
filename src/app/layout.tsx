import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daydream Generator",
  description: "SillyTavern Character Card V2 generator with JSON and PNG export."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
