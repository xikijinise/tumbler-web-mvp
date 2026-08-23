import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "不倒翁互动实验 · MVP",
  description: "用鼠标、键盘和拖拽测试不倒翁的三维受力、失衡与回正手感。",
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
