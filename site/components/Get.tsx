"use client";
// The download page's one panel: this computer's tab, the line that installs and opens Airband,
// and the file for anyone who'd rather download it. The page is built ahead, so it starts on Mac
// and moves to Windows once the browser says so. Chrome also says which Mac chip it runs on.
import { ArrowDownToLine } from "lucide-react";
import { useEffect, useState } from "react";
import { mb, type Download } from "@/lib/download";
import { Copy } from "./Copy";
import { useOs } from "./DownloadButton";
import { Apple, Windows } from "./Marks";

const KINDS = {
  mac: {
    label: "Mac",
    where: "Paste in Terminal",
    line: "curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh",
    show: "curl -fsSL airband.harshbaldaniya.com/install.sh | sh",
    files: ["mac-arm", "mac-intel"],
    allow: "A downloaded file asks once: System Settings → Privacy & Security → Open Anyway.",
  },
  windows: {
    label: "Windows",
    where: "Paste in PowerShell",
    line: "irm https://airband.harshbaldaniya.com/install.ps1 | iex",
    show: "irm airband.harshbaldaniya.com/install.ps1 | iex",
    files: ["windows"],
    allow: "A downloaded file asks once: More info → Run anyway.",
  },
} as const;

type Kind = keyof typeof KINDS;

const NAME: Record<Download["platform"], string> = { "mac-arm": "Apple silicon", "mac-intel": "Intel", windows: "Installer" };

/** "arm" or "x86" where the browser tells (Chrome and Edge), otherwise nothing. */
function useChip() {
  const [chip, setChip] = useState<string>();
  useEffect(() => {
    const ua = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
    ua?.getHighEntropyValues?.(["architecture"]).then((v) => setChip(v.architecture)).catch(() => undefined);
  }, []);
  return chip;
}

export function Get({ files }: { files: Download[] }) {
  const os = useOs();
  const chip = useChip();
  const [kind, setKind] = useState<Kind>("mac");
  useEffect(() => {
    if (os === "windows") setKind("windows");
  }, [os]);
  const k = KINDS[kind];
  const order = kind === "mac" && chip === "x86" ? (["mac-intel", "mac-arm"] as const) : k.files;
  return (
    <div className="get">
      <div className="get-tabs" role="tablist" aria-label="Computer">
        {(Object.keys(KINDS) as Kind[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={id === kind} className={id === kind ? "on" : ""} onClick={() => setKind(id)}>
            {id === "mac" ? <Apple /> : <Windows />}
            {KINDS[id].label}
          </button>
        ))}
      </div>
      <div className="get-body">
        <span className="get-label">{k.where}</span>
        <Copy text={k.line} show={k.show} block />
        <p className="get-sub">Installs Airband and opens it. Nothing to click through.</p>
        <div className="get-or">
          <span>or download the file</span>
        </div>
        <div className="get-files">
          {order.map((pl) => {
            const f = files.find((x) => x.platform === pl)!;
            return (
              <a key={pl} className="btn block" href={f.url}>
                <ArrowDownToLine />
                {NAME[pl]}
                <span className="size">{mb(f.size) || "about 3 MB"}</span>
              </a>
            );
          })}
        </div>
        <p className="get-note">{k.allow}</p>
      </div>
    </div>
  );
}
