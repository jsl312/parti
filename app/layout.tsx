import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parti — Pre-design concept studio",
  description:
    "사이트와 공간 유형에서 출발해 Problem Statement · 설계 컨셉 · 컨셉 이미지까지 잇는 사전 설계 컨셉 스튜디오.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
