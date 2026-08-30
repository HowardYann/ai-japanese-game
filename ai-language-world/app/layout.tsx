import type { Metadata } from "next";
import "./globals.css";
import FeedbackWidget from "@/components/FeedbackWidget";

export const metadata: Metadata = {
  title: "AI Language World",
  description: "进入真实生活场景，在行动与交流中掌握语言",
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
        <FeedbackWidget />
      </body>
    </html>
  );
}