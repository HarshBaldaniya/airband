import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Foot } from "@/components/Foot";
import { Smooth } from "@/components/Smooth";
import { Top } from "@/components/Top";
import { SITE } from "@/lib/site";
import { VERSION } from "@/lib/release";
import { JsonLd, siteGraph } from "@/lib/schema";
import "./globals.css";

// Three faces, each with one job: Plus Jakarta Sans for headings and titles (bold), Inter for
// everything read, JetBrains Mono for commands and code.
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.origin),
  title: { default: "Airband: every AI agent, on one frequency", template: "%s · Airband" },
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Airband", url: SITE.origin, title: "Airband: every AI agent, on one frequency", description: SITE.description },
  twitter: { card: "summary_large_image", title: "Airband: every AI agent, on one frequency", description: SITE.description },
  authors: [{ name: SITE.author.name, url: SITE.author.url }],
  creator: SITE.author.name,
  applicationName: "Airband",
  keywords: ["Airband", "AI coding agents", "Claude Code", "Codex", "Gemini CLI", "connect AI chats", "Claude Code companion", "MCP tools", "code map for AI agents", "AI coding notifications", "approve Claude Code requests", "Harsh Baldaniya"],
  category: "developer tools",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="sky" aria-hidden />
        <Smooth />
        <JsonLd data={siteGraph(VERSION)} />
        <Top />
        <main>{children}</main>
        <Foot />
      </body>
    </html>
  );
}
