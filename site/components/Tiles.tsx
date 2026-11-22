"use client";
// Three downloads as three tiles of one shape. The one for this computer is lit.
import { ArrowDownToLine } from "lucide-react";
import { mb, type Download } from "@/lib/download";
import { useOs } from "./DownloadButton";
import { Apple, Windows } from "./Marks";

const NAME: Record<Download["platform"], string> = { "mac-arm": "Mac · Apple silicon", "mac-intel": "Mac · Intel", windows: "Windows" };
const LINE: Record<Download["platform"], string> = { "mac-arm": "M1 or later", "mac-intel": "macOS 11 or later", windows: "Windows 10 or 11" };

/** The order on screen: the one for this computer in the middle. A Mac is the guess until the
 *  browser says otherwise. */
const ORDER: Record<"mac" | "windows", Download["platform"][]> = { mac: ["mac-intel", "mac-arm", "windows"], windows: ["mac-arm", "windows", "mac-intel"] };

export function Tiles({ files }: { files: Download[] }) {
  const os = useOs();
  const order = ORDER[os === "windows" ? "windows" : "mac"];
  const yours = order[1];
  const sorted = order.map((pl) => files.find((f) => f.platform === pl)!);
  return (
    <div className="tiles">
      {sorted.map((f) => {
        const on = f.platform === yours;
        return (
          <div key={f.file} className={`tile ${on ? "mid yours" : "side"}`}>
            {on && os && <span className="badge">Your computer</span>}
            {f.platform === "windows" ? <Windows className="os" /> : <Apple className="os" />}
            <b className="one">{NAME[f.platform]}</b>
            <span className="one">{LINE[f.platform]}</span>
            <a className={`btn${on ? " primary" : ""} block`} href={f.url}>
              <ArrowDownToLine /> Download
            </a>
            <small className="one">{f.platform === "windows" ? ".exe" : ".dmg"} · {mb(f.size) || "about 2 MB"}</small>
          </div>
        );
      })}
    </div>
  );
}
