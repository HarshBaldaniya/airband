"use client";
// "Download for Mac" or "for Windows", for the computer the page is open on. It starts as a link
// to the downloads page (the page is built ahead, so it can't know), and becomes the file once the
// browser says what it runs on. A Mac gets the Apple silicon file: Safari can't tell the two apart,
// and Intel Macs are a few years old now, so the page names the other one under it.
import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";
import { useEffect, useState } from "react";
import type { Download } from "@/lib/download";
import { Apple, Windows } from "./Marks";

type Os = "mac" | "windows" | "other";

export function useOs(): Os | undefined {
  const [os, setOs] = useState<Os>();
  useEffect(() => {
    const p = `${(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`.toLowerCase();
    const touch = navigator.maxTouchPoints > 1;
    setOs(/mac/.test(p) && !touch ? "mac" : /win/.test(p) ? "windows" : "other");
  }, []);
  return os;
}

/** The button: the file for this computer, or the downloads page. */
export function DownloadButton({ files }: { files: Download[] }) {
  const os = useOs();
  const f = files.find((x) => x.platform === (os === "mac" ? "mac-arm" : "windows"))!;
  if (os === "mac" || os === "windows")
    return (
      <a className="btn primary" href={f.url}>
        {os === "mac" ? <Apple /> : <Windows />}
        Download for {os === "mac" ? "Mac" : "Windows"}
      </a>
    );
  return (
    <Link className="btn primary" href="/download/">
      <ArrowDownToLine />
      Download
    </Link>
  );
}

/** The line under it: the other Mac, every download, or what Linux has. */
export function DownloadNote({ files }: { files: Download[] }) {
  const os = useOs();
  const intel = files.find((x) => x.platform === "mac-intel")!;
  return (
    <p className="also">
      {os === "mac" ? (
        <>
          For Macs with Apple silicon. <a href={intel.url}>Intel Mac?</a> · <Link href="/download/">All downloads</Link>
        </>
      ) : os === "windows" ? (
        <>
          Windows 10 or 11. <Link href="/download/">All downloads</Link>
        </>
      ) : (
        <>For Mac and Windows. On Linux, the command line has everything.</>
      )}
    </p>
  );
}
