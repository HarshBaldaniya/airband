// What reached which chat, for the board's numbers (~/.airband/deliveries.jsonl).
import * as fs from "node:fs";
import type { Delivery } from "../core/types";
import { airbandFile } from "../core/paths";
import { parseJsonLines } from "../core/json";

export function logDelivery(d: Delivery): void {
  fs.mkdirSync(airbandFile(), { recursive: true });
  fs.appendFileSync(airbandFile("deliveries.jsonl"), `${JSON.stringify(d)}\n`);
}

/** The most recent deliveries (the log is only ever read from its tail). */
export function readDeliveries(max = 2000): Delivery[] {
  const file = airbandFile("deliveries.jsonl");
  try {
    const size = fs.statSync(file).size;
    const want = Math.min(size, max * 160);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(want);
      fs.readSync(fd, buf, 0, want, size - want);
      const lines = parseJsonLines<Delivery>(buf.toString("utf8"));
      return lines.slice(-max);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}
