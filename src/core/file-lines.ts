// Reading the agents' chat files, which can run to a gigabyte: the last lines only, or whole lines
// from a byte offset, never a line still being written.
import * as fs from "node:fs";
import { MiB } from "./units";

const CHUNK = 4 * MiB;

/**
 * The last whole lines of a file, from its final `bytes` only: enough for a chat's latest
 * model and context without reading a history that can run to a gigabyte.
 */
export function readTail(file: string, bytes = 512 * 1024): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // the first line was cut in half
    if (lines.length && !lines[lines.length - 1].endsWith("}")) lines.pop(); // still being written
    return lines.filter(Boolean);
  } catch {
    return [];
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The whole lines written after `offset`, and the offset after the last one (an unfinished last
 * line is left for next time). With `maxBytes`, stops after about that much, so a huge file can be
 * read a slice at a time. Lines are split on the newline byte before decoding, so a character cut
 * at a chunk's edge is never mangled.
 */
export function readLinesFrom(file: string, offset: number, maxBytes = Infinity): { lines: string[]; next: number } {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { lines: [], next: offset };
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (offset > size) offset = 0; // the file was replaced
    const lines: string[] = [];
    let pos = offset;
    let next = offset;
    let pending: Buffer[] = [];
    // A single line longer than the slice is still read whole.
    while (pos < size && (pos - offset < maxBytes || lines.length === 0)) {
      const len = Math.min(CHUNK, size - pos, Math.max(64 * 1024, maxBytes));
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      pos += len;
      const nl = buf.lastIndexOf(0x0a);
      if (nl === -1) {
        pending.push(buf);
        continue;
      }
      lines.push(...Buffer.concat([...pending, buf.subarray(0, nl)]).toString("utf8").split("\n"));
      pending = [buf.subarray(nl + 1)];
      next = pos - (len - nl - 1);
    }
    return { lines, next };
  } finally {
    fs.closeSync(fd);
  }
}

export function fileSize(file: string | undefined): number {
  if (!file) return 0;
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
