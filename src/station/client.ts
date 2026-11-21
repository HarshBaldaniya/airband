// The hook's side of the Station: hands a permission request to the Airband app and waits for the
// person's click. It never blocks a chat for long. With no app running it gives up in well under a
// second, and after DECISION_MS with no click it gives up too. The agent then asks in its own
// terminal, as it always did.
import * as fs from "node:fs";
import * as http from "node:http";
import { airbandFile } from "../core/paths";
import type { Answer } from "./reply";

/** Where the running Station says it listens. Written by the Station, read by the hook. */
export interface StationInfo {
  port: number;
  token: string;
  pid: number;
  at: number;
  /** Off: the Station shows chats but leaves every permission request to the terminal. */
  approvals: boolean;
  /** How long the hook waits for a click before the terminal asks, in ms. */
  waitMs?: number;
}

export const stationFile = () => airbandFile("station.json");
/** The longest a request waits. Claude Code's hook is set to 120 s, so this ends first. */
export const DECISION_MS = 110_000;
const CONNECT_MS = 400;

export function readStationInfo(): StationInfo | undefined {
  try {
    const info = JSON.parse(fs.readFileSync(stationFile(), "utf8")) as StationInfo;
    if (!info.port || !info.token) return undefined;
    try {
      process.kill(info.pid, 0);
    } catch (e) {
      // ESRCH: the app is gone. EPERM: alive, just not ours to signal.
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return undefined;
    }
    return info;
  } catch {
    return undefined;
  }
}

/** POSTs JSON to the Station and reads the JSON answer, within `budgetMs`. */
export function stationPost<T>(info: Pick<StationInfo, "port" | "token">, route: string, body: unknown, budgetMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    let done = false;
    const finish = (v: T | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const req = http.request(
      { host: "127.0.0.1", port: info.port, path: route, method: "POST", headers: { "content-type": "application/json", "content-length": data.length, "x-airband-token": info.token } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          try {
            finish(res.statusCode === 200 ? (JSON.parse(text) as T) : undefined);
          } catch {
            finish(undefined);
          }
        });
        res.on("error", () => finish(undefined));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(undefined);
    }, budgetMs);
    // No connection quickly: the app is not there, or not answering. The terminal asks at once.
    req.setTimeout(CONNECT_MS, () => {
      if (!req.socket || req.socket.connecting) {
        req.destroy();
        finish(undefined);
      }
    });
    req.on("socket", (s) => s.once("connect", () => req.setTimeout(0)));
    req.on("error", () => finish(undefined));
    req.end(data);
  });
}

export interface PermissionAsk {
  agent: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: unknown;
}

/** Asks the person through the Station. Nothing comes back when there is no Station or no click. */
export async function askStation(ask: PermissionAsk, info = readStationInfo()): Promise<Answer | undefined> {
  if (!info || info.approvals === false || process.env.AIRBAND_NO_STATION) return undefined;
  const wait = Math.min(info.waitMs ?? DECISION_MS, DECISION_MS);
  const res = await stationPost<{ answer?: Answer }>(info, "/api/hook/permission", { ...ask, waitMs: wait }, wait + 2000);
  return res?.answer;
}
