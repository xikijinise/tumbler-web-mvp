import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "不倒翁打击实验场 · MVP",
  description: "用鼠标和键盘测试不倒翁的受力、失衡与回正手感。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
