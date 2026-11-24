"use client";
// Which computer the page is open on: a Mac, Windows, or anything else. Undefined until the
// browser answers (the page is built ahead).
import { useEffect, useState } from "react";

export type Os = "mac" | "windows" | "other";

export function useOs(): Os | undefined {
  const [os, setOs] = useState<Os>();
  useEffect(() => {
    const p = `${(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`.toLowerCase();
    const touch = navigator.maxTouchPoints > 1;
    setOs(/mac/.test(p) && !touch ? "mac" : /win/.test(p) ? "windows" : "other");
  }, []);
  return os;
}
