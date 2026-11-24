// One writer at a time: a lock file per shared file, so two hooks (or a hook and the extension)
// never lose each other's change.
import * as fs from "node:fs";
import * as path from "node:path";
import { airbandFile } from "../core/paths";

/** A lock older than this was left by a process that died: it is taken over. */
const LOCK_STALE_MS = 5_000;
/** How long a writer waits for a lock before it writes anyway. */
const LOCK_WAIT_MS = 2_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Runs `fn` while holding a lock file, so two hooks (or a hook and the extension) changing the same
 * file never lose each other's change. A lock that can't be had in time is broken: a stuck writer
 * must not stop every chat.
 */
export function withLock<T>(name: string, fn: () => T): T {
  const dir = airbandFile("locks");
  const lock = path.join(dir, `${name}.lock`);
  fs.mkdirSync(dir, { recursive: true });
  const until = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      held = true;
    } catch {
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
      if (age > LOCK_STALE_MS || Date.now() > until) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
