// The phone app's few saved things, in IndexedDB so its service worker reads them too: the pairing
// (room, secret, the computer's notification key), this phone's id, and which key alerts were set up for.
import type { Pairing } from "../../../src/remote/box";

const DB = "airband";
const STORE = "kv";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function put(key: string, value: unknown): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    if (value === undefined) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const savedPairing = () => get<Pairing>("pairing");
export const savePairing = (p: Pairing | undefined) => put("pairing", p);

/** This phone's own id: the computer keeps its alerts under it. */
export async function phoneId(): Promise<string> {
  const known = await get<string>("phone");
  if (known) return known;
  const id = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await put("phone", id);
  return id;
}
