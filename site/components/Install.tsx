"use client";
// One line that installs the app and opens it, for the computer the page is open on. A file fetched
// in a terminal isn't marked as downloaded by a browser, so neither system stops it on first start.
import { useEffect, useState } from "react";
import { Copy } from "./Copy";
import { useOs } from "./DownloadButton";

const LINES = {
  mac: { label: "Mac", text: "curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh", where: "Paste it in Terminal." },
  windows: { label: "Windows", text: "irm https://airband.harshbaldaniya.com/install.ps1 | iex", where: "Paste it in PowerShell." },
} as const;

type Kind = keyof typeof LINES;

export function Install() {
  const os = useOs();
  const [kind, setKind] = useState<Kind>("mac");
  useEffect(() => {
    if (os === "windows") setKind("windows");
  }, [os]);
  const line = LINES[kind];
  return (
    <div className="install">
      <div className="install-top">
        <b>Install in one line</b>
        <div className="seg" role="tablist" aria-label="Computer">
          {(Object.keys(LINES) as Kind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} className={k === kind ? "on" : ""} onClick={() => setKind(k)}>
              {LINES[k].label}
            </button>
          ))}
        </div>
      </div>
      <Copy text={line.text} block />
      <p>{line.where} It installs Airband and opens it, with no warning to click through.</p>
    </div>
  );
}
