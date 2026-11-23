"use client";
// The hero's two ways in, named for the computer the page is open on (the page is built ahead, so
// it says Mac until the browser answers).
import Link from "next/link";
import { ArrowDownToLine, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Copy } from "./Copy";
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

/** The button: named for this computer, and it opens the downloads page, where the one-line
 *  install comes first (a file from the browser makes the system warn on its first start). */
export function DownloadButton() {
  const os = useOs();
  // Clicked: a spinner until the downloads page is there.
  const [going, setGoing] = useState(false);
  return (
    <Link className="btn primary" href="/download/" onClick={() => setGoing(true)} aria-busy={going}>
      {going ? <LoaderCircle className="spin" /> : os === "mac" ? <Apple /> : os === "windows" ? <Windows /> : <ArrowDownToLine />}
      {os === "mac" ? "Download for Mac" : os === "windows" ? "Download for Windows" : "Download"}
    </Link>
  );
}

/** The one-line install for this computer, shown without "https://"; the copy is the full line.
 *  On anything but a Mac or Windows, the command line. */
export function InstallLine() {
  const os = useOs();
  if (os === "windows") return <Copy text="irm https://airband.harshbaldaniya.com/install.ps1 | iex" show="irm airband.harshbaldaniya.com/install.ps1 | iex" />;
  if (os === "other") return <Copy text="npx airband" />;
  return <Copy text="curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh" show="curl -fsSL airband.harshbaldaniya.com/install.sh | sh" />;
}
