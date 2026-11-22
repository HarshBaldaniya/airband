import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Copy } from "@/components/Copy";
import { Get } from "@/components/Get";
import { GitHub, Npm } from "@/components/Marks";
import { Reveal } from "@/components/Reveal";
import { NEW_TAB } from "@/lib/ext";
import { downloads, VERSION } from "@/lib/release";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Download", description: "Airband for Mac and Windows, about 2 MB, or npx airband on any computer.", alternates: { canonical: "/download/" } };

const THEN = [
  { title: "Roger opens", line: "In a corner of your screen" },
  { title: "He finds your agents", line: "Every one on this computer" },
  { title: "They're connected", line: "Chats share what they did" },
];

export default async function DownloadPage() {
  const files = await downloads();
  return (
    <div className="page">
      <div className="wrap">
        <Reveal className="head">
          <h1 className="grad">Download Airband</h1>
          <p>Version {VERSION}. About 2 MB, and Roger sets up the rest.</p>
        </Reveal>
        <Reveal delay={0.05}>
          <Get files={files} />
        </Reveal>
        <Reveal delay={0.15}>
          <div className="then" id="first">
            {THEN.map((t, i) => (
              <div key={t.title}>
                <span className="n">0{i + 1}</span>
                <span>
                  <b className="one">{t.title}</b>
                  <span className="one">{t.line}</span>
                </span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="alt">
            <b>Only the agents, no app</b>
            <Copy text="npx airband" />
            <a className="pill" href={SITE.npm} {...NEW_TAB}>
              <Npm /> npm <ArrowUpRight className="arrow" />
            </a>
            <a className="pill" href={SITE.repo} {...NEW_TAB}>
              <GitHub size={17} /> GitHub <ArrowUpRight className="arrow" />
            </a>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
