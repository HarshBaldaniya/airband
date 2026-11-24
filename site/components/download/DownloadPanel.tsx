"use client";
// The download page's one panel: this computer's tab, the line that installs and opens Airband,
// and the file for anyone who'd rather download it. The page is built ahead, so it starts on Mac
// and moves to Windows once the browser says so. Chrome also says which Mac chip it runs on.
import { ArrowDownToLine, Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mb, type Download } from "@/lib/download";
import { CopyCommand } from "@/components/ui/CopyCommand";
import { useOs } from "@/components/download/useOs";
import { Apple, Windows } from "@/components/ui/BrandMarks";

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

/** A file button after its click: GitHub takes a moment to start the download, so the button says
 *  it is starting, then where the file went. */
type Started = { platform: Download["platform"]; step: "starting" | "started" };

export function DownloadPanel({ files, version }: { files: Download[]; version: string }) {
  const [started, setStarted] = useState<Started>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const start = (platform: Download["platform"]) => {
    timers.current.forEach(clearTimeout);
    setStarted({ platform, step: "starting" });
    timers.current = [setTimeout(() => setStarted({ platform, step: "started" }), 3500), setTimeout(() => setStarted(undefined), 9000)];
  };
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
        <CopyCommand text={k.line} show={k.show} block />
        <p className="get-sub">Installs Airband and opens it. Nothing to click through.</p>
        <div className="get-or">
          <span>or download the file</span>
        </div>
        <div className="get-files">
          {order.map((pl) => {
            const f = files.find((x) => x.platform === pl)!;
            const s = started?.platform === pl ? started.step : undefined;
            return (
              <a key={pl} className={`btn block${s ? ` ${s}` : ""}`} href={f.url} onClick={() => start(pl)} aria-live="polite">
                {s === "starting" ? <LoaderCircle className="spin" /> : s === "started" ? <Check /> : <ArrowDownToLine />}
                {s === "starting" ? "Starting download…" : s === "started" ? "Check your downloads" : NAME[pl]}
                {!s && (
                  <span className="size">
                    {mb(f.size) || "about 3 MB"}
                    {f.version !== version && ` · ${f.version}`}
                  </span>
                )}
              </a>
            );
          })}
        </div>
        <p className="get-note">{k.allow}</p>
      </div>
    </div>
  );
}
