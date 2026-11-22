import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Copy } from "@/components/Copy";
import { GitHub, Npm } from "@/components/Marks";
import { Reveal } from "@/components/Reveal";
import { Tiles } from "@/components/Tiles";
import { NEW_TAB } from "@/lib/ext";
import { downloads, VERSION } from "@/lib/release";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Download", description: "Airband for Mac and Windows, about 2 MB, or npx airband on any computer.", alternates: { canonical: "/download/" } };

const THEN = [
  { title: "Open it", line: "Drag to Applications, or run it" },
  { title: "Allow it once", line: "It isn't signed yet" },
  { title: "Follow Roger", line: "He sets up the rest" },
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
        <Reveal delay={0.1}>
          <Tiles files={files} />
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
          <p className="head" style={{ margin: "18px auto 0", fontSize: 13.5, color: "var(--faint)" }}>
            Mac: Privacy &amp; Security → Open Anyway · Windows: More info → Run anyway
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="alt">
            <b>Or in a terminal</b>
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
