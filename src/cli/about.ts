// Who and what this copy of Airband is: version, system, where it is installed, and the links.
import * as fs from "node:fs";
import * as os from "node:os";
import { airbandHome } from "../core/paths";
import { output } from "../core/process";
import { agentSummary, installedVersion } from "../core/setup";
import { VERSION } from "../core/version";
import type { OurCommand } from "./package-managers";

export const REPO = "https://github.com/HarshBaldaniya/airband";
export const DOCS = `${REPO}#readme`;
const ISSUES = `${REPO}/issues`;
export const CHANGELOG = `${REPO}/blob/main/CHANGELOG.md`;

/** "macOS 15.1 (Apple silicon)", "Windows 10.0.26100 (x64)", "Ubuntu 24.04.1 LTS (arm64)". */
function systemName(): string {
  const run = (cmd: string, args: string[]) => output(cmd, args, 2000)?.trim() ?? "";
  if (process.platform === "darwin") {
    // An Intel build of Node.js on an Apple silicon Mac runs under Rosetta.
    const rosetta = process.arch === "x64" && run("sysctl", ["-in", "sysctl.proc_translated"]) === "1";
    const chip = process.arch === "arm64" || rosetta ? "Apple silicon" : "Intel";
    return `macOS ${run("sw_vers", ["-productVersion"]) || os.release()} (${chip}${rosetta ? ", under Rosetta" : ""})`;
  }
  if (process.platform === "win32") return `Windows ${os.release()} (${process.arch})`;
  if (process.platform === "linux") {
    let name = "";
    try {
      name = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8"))?.[1] ?? "";
    } catch {
      // Not every Linux has it.
    }
    return `${name || `Linux ${os.release()}`} (${process.arch})`;
  }
  return `${os.type()} ${os.release()} (${process.arch})`;
}

const tilde = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);

export interface AboutInfo {
  version: string;
  latest?: string;
  node: string;
  system: string;
  files: string;
  filesVersion?: string;
  command?: string;
  installedWith?: string;
  agents: string[];
}

export function aboutInfo(command: OurCommand | undefined, latest?: string): AboutInfo {
  return {
    version: VERSION,
    latest,
    node: process.versions.node,
    system: systemName(),
    files: tilde(airbandHome()),
    filesVersion: installedVersion(),
    command: command ? tilde(command.path) : undefined,
    installedWith: command?.by,
    agents: agentSummary().map((a) => a.name),
  };
}

/** A new GitHub issue with the facts that help, already filled in. Nothing is sent until the person
 *  presses Submit on GitHub, and no file paths or names are included. */
export function bugUrl(a: AboutInfo): string {
  const body = [
    "**What happened**",
    "",
    "",
    "**What you expected**",
    "",
    "",
    "**Steps to see it**",
    "1. ",
    "",
    "---",
    `Airband ${a.version} · Node.js ${a.node} · ${a.system}`,
    `Agents: ${a.agents.join(", ") || "none found"}${a.installedWith ? ` · installed with ${a.installedWith}` : ""}`,
  ].join("\n");
  return `${ISSUES}/new?body=${encodeURIComponent(body)}`;
}
