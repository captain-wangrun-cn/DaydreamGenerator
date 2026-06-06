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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}else{var h=new Date().getHours();document.documentElement.dataset.theme=h>=6&&h<18?"light":"dark"}})()`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
