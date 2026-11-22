"use client";
// Three ways in, as three cards of one shape: an icon, a one-line title, a one-line line and one
// action at the bottom.
import { AppWindow, Puzzle, SquareTerminal } from "lucide-react";
import { type Download } from "@/lib/download";
import { Copy } from "./Copy";
import { useOs } from "./DownloadButton";
import { Apple, Windows } from "./Marks";

export function Ways({ files }: { files: Download[] }) {
  const os = useOs();
  const f = files.find((x) => x.platform === (os === "windows" ? "windows" : "mac-arm"))!;
  return (
    <div className="three">
      <div className="way lead">
        <span className="ic">
          <AppWindow />
        </span>
        <b className="one">Desktop app</b>
        <span className="one">Roger on your screen, about 2 MB</span>
        <div className="act">
          <a className="btn primary block" href={f.url}>
            {f.platform === "windows" ? <Windows /> : <Apple />}
            Download for {f.platform === "windows" ? "Windows" : "Mac"}
          </a>
        </div>
      </div>
      <div className="way">
        <span className="ic">
          <SquareTerminal />
        </span>
        <b className="one">Command line</b>
        <span className="one">Any computer with Node.js 20+</span>
        <div className="act">
          <Copy text="npx airband" block />
        </div>
      </div>
      <div className="way">
        <span className="ic">
          <Puzzle />
        </span>
        <b className="one">Claude Code plugin</b>
        <span className="one">Inside Claude Code, in one line</span>
        <div className="act">
          <Copy text="/plugin install airband --marketplace HarshBaldaniya/airband" show="/plugin install airband" block />
        </div>
      </div>
    </div>
  );
}
