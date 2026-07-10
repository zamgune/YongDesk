import type { Metadata } from "next";
import { DM_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  weight: ["300", "400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "트레이딩 신호 워크벤치",
  description: "종목별 추세추종 신호와 시장 대장주 스캐너",
};

const themeScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("stock-analysis-theme");
    const theme = stored === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${dmMono.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
