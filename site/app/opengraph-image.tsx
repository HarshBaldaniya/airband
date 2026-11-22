// The share card for every page: the real wordmark, the line in the heading face, the agents.
// 1200 x 630. The heading face comes from Google Fonts at build time; without it the card still
// renders, in the default face.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Airband: every AI agent, on one frequency";

async function face(weight: number): Promise<ArrayBuffer | undefined> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@${weight}`)).text();
    const url = /src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : undefined;
  } catch {
    return undefined;
  }
}

export default async function OgImage() {
  const mark = `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "..", "media", "airband-wordmark-dark.svg")).toString("base64")}`;
  const [bold, semi] = await Promise.all([face(800), face(600)]);
  const fonts = [
    ...(bold ? [{ name: "Jakarta", data: bold, weight: 800 as const, style: "normal" as const }] : []),
    ...(semi ? [{ name: "Jakarta", data: semi, weight: 600 as const, style: "normal" as const }] : []),
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: "radial-gradient(70% 90% at 50% -10%, rgba(224,122,79,0.45), #09090b 70%)", color: "#f5f5f7", fontFamily: "Jakarta" }}>
        <img src={mark} height={52} style={{ height: 52, width: 196 }} />
        <div style={{ marginTop: 44, fontSize: 92, fontWeight: 800, letterSpacing: -4, lineHeight: 1.02 }}>Every AI agent,</div>
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -4, lineHeight: 1.02, color: "#f39b72" }}>on one frequency.</div>
        <div style={{ marginTop: 38, fontSize: 30, fontWeight: 600, color: "#a5a5ae" }}>Claude Code · Codex · Gemini CLI · free and open source</div>
      </div>
    ),
    { ...size, fonts },
  );
}
