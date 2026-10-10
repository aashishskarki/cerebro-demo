import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cerebro: Brand Mention Scanner",
  description:
    "Type a brand name and see where it was mentioned in the last 30 days across news sites, Reddit and YouTube.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
