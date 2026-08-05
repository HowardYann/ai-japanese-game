import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Language World",
  description: "可以安全体验另一种人生的世界",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <body
        className="min-h-screen bg-neutral-950 text-neutral-100"
        suppressHydrationWarning
      >

        {children}
      </body>
    </html>
  );
}
