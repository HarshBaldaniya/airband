// What a download is, for the pages and the browser alike (no file reading here).
export type Platform = "mac-arm" | "mac-intel" | "windows";

export interface Download {
  platform: Platform;
  label: string;
  detail: string;
  file: string;
  /** The version this file is: the newest release that has it. */
  version: string;
  url: string;
  /** Bytes, when GitHub answered. */
  size?: number;
  /** "sha256:…", when GitHub has it. */
  digest?: string;
}

export const mb = (bytes?: number) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : "");
