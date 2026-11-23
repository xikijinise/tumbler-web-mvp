import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "果冻不倒翁 · 3D 软体互动",
  description: "晶莹 Q 弹的 3D 果冻不倒翁，内嵌悬浮像素狗头夹心，支持直接戳压、拉扯回弹、多口味与软硬度切换。",
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
