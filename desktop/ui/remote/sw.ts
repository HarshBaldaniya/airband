// The phone app's service worker: it shows a notification when the computer sends one (locked for
// this phone; the browser unlocks it), and answers Allow or Deny from the notification's buttons
// where the phone offers them (Android). On an iPhone a tap opens the app at the request.
import { openBox, seal } from "../../../src/remote/box";
import { savedPairing } from "./store";

interface Note {
  title: string;
  body: string;
  tag: string;
  id?: string;
  kind?: "request" | "question" | "done";
}

interface NotificationEvent extends Event {
  action: string;
  notification: Notification & { data?: Note };
  waitUntil(p: Promise<unknown>): void;
}

interface PushEvent extends Event {
  data?: { json(): unknown };
  waitUntil(p: Promise<unknown>): void;
}

interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}

const sw = self as unknown as {
  registration: ServiceWorkerRegistration;
  clients: { matchAll(o: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClientLike[]>; openWindow(url: string): Promise<unknown>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, cb: (e: never) => void): void;
};

sw.addEventListener("install", () => void sw.skipWaiting());
sw.addEventListener("activate", (e: { waitUntil(p: Promise<unknown>): void }) => e.waitUntil(sw.clients.claim()));

sw.addEventListener("push", (e: PushEvent) => {
  let n: Note;
  try {
    n = e.data?.json() as Note;
  } catch {
    n = { title: "Airband", body: "Something changed on your computer.", tag: "airband" };
  }
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: n.body,
    tag: n.tag,
    data: n,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    ...(n.kind === "request" ? { actions: [{ action: "allow", title: "Allow" }, { action: "deny", title: "Deny" }], requireInteraction: true } : {}),
  };
  e.waitUntil(sw.registration.showNotification(n.title, options));
});

async function openApp(): Promise<void> {
  const open = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (open[0]) await open[0].focus();
  else await sw.clients.openWindow("/");
}

async function answer(id: string, decision: "allow" | "deny"): Promise<void> {
  const pairing = await savedPairing();
  if (!pairing) return openApp();
  const box = await openBox(pairing.secret);
  const d = await seal(box, { t: "decide", n: 0, id, decision });
  const res = await fetch(`/r/${pairing.room}/send`, { method: "POST", headers: { "content-type": "application/json", "x-room-token": box.token }, body: JSON.stringify({ d }) });
  if (res.status === 409) await sw.registration.showNotification("Your computer is offline", { body: "The request waits there until it's back.", tag: "offline" });
}

sw.addEventListener("notificationclick", (e: NotificationEvent) => {
  e.notification.close();
  const n = e.notification.data;
  if (n?.id && (e.action === "allow" || e.action === "deny")) e.waitUntil(answer(n.id, e.action).catch(openApp));
  else e.waitUntil(openApp());
});
