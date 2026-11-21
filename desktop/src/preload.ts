// The only things the companion's screen may ask of the app: where its window is, a drag, the
// app's menu, the QR code for the phone, and the app's own settings. Given to the Station's page
// on this computer and nothing else. It reads no files and runs nothing.
import { contextBridge, ipcRenderer } from "electron";

if (location.hostname === "127.0.0.1") {
  contextBridge.exposeInMainWorld("airbandDesktop", {
    setHit: (hit: boolean) => ipcRenderer.send("hit", hit),
    dragStart: (figure: { x: number; y: number; width: number; height: number }) => ipcRenderer.send("drag-start", figure),
    dragMove: () => ipcRenderer.send("drag-move"),
    dragEnd: () => ipcRenderer.send("drag-end"),
    onPlace: (cb: (p: unknown) => void) => ipcRenderer.on("place", (_e, p) => cb(p)),
    onCursor: (cb: (p: unknown) => void) => ipcRenderer.on("cursor", (_e, p) => cb(p)),
    onCommand: (cb: (c: string) => void) => ipcRenderer.on("command", (_e, c) => cb(c)),
    onPrefs: (cb: (p: unknown) => void) => ipcRenderer.on("prefs", (_e, p) => cb(p)),
    qr: (text: string) => ipcRenderer.invoke("qr", text),
    prefs: () => ipcRenderer.invoke("prefs"),
    setPref: (key: string, on: boolean) => ipcRenderer.send("pref", key, on),
    showMenu: () => ipcRenderer.send("menu"),
    hide: () => ipcRenderer.send("hide"),
    setAsleep: (asleep: boolean) => ipcRenderer.send("asleep", asleep),
  });
}
