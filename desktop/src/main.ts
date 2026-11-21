// The Airband app: a companion in a corner of the screen, and the Station behind it. One process
// runs both. On first start it sets up Airband in Claude Code, Codex and Gemini CLI by itself, so
// the download is the only step. Lives in the menu bar, not the Dock.
//
// The companion's window keeps one size and lets clicks through everywhere except on what it draws,
// so opening a panel or a card never moves or redraws the companion.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import QRCode from "qrcode";
import { airbandFile, readJson, writeFileAtomic } from "../../src/core/paths";
import { needsSetup, setup, VERSION } from "../../src/core/setup";
import { DEFAULT_COMPANION, Station, type PendingView, type StationState } from "../../src/station";
import { colorIconPng, trayIconPng } from "./icon";

type Side = "left" | "right";
type Vertical = "top" | "bottom";

interface Prefs {
  sound: boolean;
  notify: boolean;
  startAtLogin: boolean;
  /** The window is hidden (from the menu bar). */
  hidden: boolean;
  /** The companion is tucked away: small, no cards, until clicked. */
  tucked: boolean;
  /** Where the window sits: the corner of it the companion is in, and that corner's place on screen. */
  anchor?: { x: number; y: number; side: Side; vertical: Vertical };
  lastSummary?: string;
}

const prefsFile = () => airbandFile("desktop.json");
const MARGIN = 14;
/** The window: wide enough for a card or the panel, tall enough for the panel above the companion. */
const WINDOW = { w: 424, h: 700 };
/** Where the companion sits in its corner of the window (the screen's own padding included). */
const FIGURE = { w: 104, h: 125, pad: 10 };

let prefs: Prefs = { sound: true, notify: true, startAtLogin: true, hidden: false, tucked: false };
let station: Station;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let state: StationState | undefined;
let drag: { cursor: Electron.Point; at: Electron.Point; figure: Electron.Rectangle } | undefined;

const name = () => state?.settings.companion.name ?? DEFAULT_COMPANION.name;
/** Where the app's copy of Airband (hook, MCP server, the companion's screen) is. */
const resources = () => (app.isPackaged ? path.join(process.resourcesPath, "airband") : path.resolve(__dirname, "../../dist"));

function savePrefs(): void {
  try {
    writeFileAtomic(prefsFile(), JSON.stringify(prefs, null, 2));
  } catch {
    // Remembered next time instead.
  }
}

// ---- where the companion sits ----

function windowSize(): { w: number; h: number } {
  const wa = screen.getPrimaryDisplay().workArea;
  return { w: WINDOW.w, h: Math.min(WINDOW.h, wa.height - 2 * MARGIN) };
}

/** The default: the bottom-right corner of the main screen. */
function defaultAnchor(): NonNullable<Prefs["anchor"]> {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - MARGIN, y: wa.y + wa.height - MARGIN, side: "right", vertical: "bottom" };
}

/** The window's bounds with its anchored corner at the anchor. The transparent rest may run off screen. */
function boundsFor(a: NonNullable<Prefs["anchor"]>): Electron.Rectangle {
  const s = windowSize();
  return { x: Math.round(a.side === "right" ? a.x - s.w : a.x), y: Math.round(a.vertical === "bottom" ? a.y - s.h : a.y), width: s.w, height: s.h };
}

function anchorOnScreen(a: NonNullable<Prefs["anchor"]>): boolean {
  return screen.getAllDisplays().some((d) => a.x >= d.bounds.x - 1 && a.x <= d.bounds.x + d.bounds.width + 1 && a.y >= d.bounds.y - 1 && a.y <= d.bounds.y + d.bounds.height + 1);
}

function place(): void {
  if (!win) return;
  const a = prefs.anchor && anchorOnScreen(prefs.anchor) ? prefs.anchor : defaultAnchor();
  win.webContents.send("place", { side: a.side, vertical: a.vertical });
  win.setBounds(boundsFor(a));
}

/**
 * After a drag: the companion stays where it was dropped. Its corner of the window is the one
 * towards the screen's nearest edges, so the cards open towards the middle; near an edge it snaps in.
 */
function settle(figure: Electron.Rectangle): void {
  if (!win) return;
  const b = win.getBounds();
  const cx = b.x + figure.x + figure.width / 2;
  const cy = b.y + figure.y + figure.height / 2;
  const wa = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }).workArea;
  const side: Side = cx > wa.x + wa.width / 2 ? "right" : "left";
  const vertical: Vertical = cy > wa.y + wa.height / 2 ? "bottom" : "top";
  // The window corner that puts the companion's centre where it was dropped.
  const half = { w: FIGURE.w / 2 + FIGURE.pad, h: FIGURE.h / 2 + FIGURE.pad };
  let x = side === "right" ? cx + half.w : cx - half.w;
  let y = vertical === "bottom" ? cy + half.h : cy - half.h;
  const SNAP = 80;
  if (side === "right" && wa.x + wa.width - x < SNAP) x = wa.x + wa.width - MARGIN;
  if (side === "left" && x - wa.x < SNAP) x = wa.x + MARGIN;
  if (vertical === "bottom" && wa.y + wa.height - y < SNAP) y = wa.y + wa.height - MARGIN;
  if (vertical === "top" && y - wa.y < SNAP) y = wa.y + MARGIN;
  // Always fully on screen.
  x = side === "right" ? Math.min(Math.max(x, wa.x + 2 * half.w), wa.x + wa.width) : Math.max(Math.min(x, wa.x + wa.width - 2 * half.w), wa.x);
  y = vertical === "bottom" ? Math.min(Math.max(y, wa.y + 2 * half.h), wa.y + wa.height) : Math.max(Math.min(y, wa.y + wa.height - 2 * half.h), wa.y);
  prefs.anchor = { x: Math.round(x), y: Math.round(y), side, vertical };
  savePrefs();
  place();
}

// ---- the window ----

function createWindow(): void {
  win = new BrowserWindow({
    ...boundsFor(prefs.anchor && anchorOnScreen(prefs.anchor) ? prefs.anchor : defaultAnchor()),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // The first click on the companion counts (a drag starts at once), even while another app is in front.
    acceptFirstMouse: true,
    enableLargerThanScreen: true,
    show: false,
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  const origin = `http://127.0.0.1:${station.port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) e.preventDefault();
  });
  win.webContents.on("did-finish-load", () => {
    place();
    if (!prefs.hidden) win?.showInactive();
  });
  void win.loadURL(`${origin}/app?mode=desktop&t=${station.token}`);
  win.on("closed", () => (win = undefined));
}

function show(open = false): void {
  if (!win) createWindow();
  prefs.hidden = false;
  if (open) setPref("tucked", false);
  savePrefs();
  win!.showInactive();
  if (open) {
    win!.focus();
    win!.webContents.send("command", "open");
  }
  menu();
}

function hide(): void {
  prefs.hidden = true;
  savePrefs();
  win?.hide();
  menu();
}

// ---- menus ----

function menuItems(short = false): Electron.MenuItemConstructorOptions[] {
  const s = state;
  const visible = !!win?.isVisible();
  const check = (label: string, on: boolean, click: () => void): Electron.MenuItemConstructorOptions => ({ label, type: "checkbox", checked: on, click });
  const core: Electron.MenuItemConstructorOptions[] = [
    { label: "Open my chats", accelerator: "Alt+CommandOrControl+R", click: () => show(true) },
    prefs.tucked ? { label: `Bring ${name()} back`, click: () => setPref("tucked", false) } : { label: `Tuck ${name()} away`, click: () => setPref("tucked", true) },
    visible ? { label: `Hide ${name()}`, click: hide } : { label: `Show ${name()}`, click: () => show() },
    { label: `Put ${name()} back in the corner`, click: () => ((prefs.anchor = undefined), savePrefs(), show()) },
    { label: "Settings…", click: () => (show(), setPref("tucked", false), win?.webContents.send("command", "settings")) },
  ];
  if (short) return [...core, { type: "separator" }, { label: "Quit Airband", click: () => app.quit() }];
  return [
    { label: s?.headline ?? "Starting…", enabled: false },
    { type: "separator" },
    ...core,
    { type: "separator" },
    check("Answer requests here", !!s?.settings.approvals, () => void station.setSettings({ approvals: !s?.settings.approvals })),
    check("Sounds", prefs.sound, () => setPref("sound", !prefs.sound)),
    check(`Notifications when ${name()} is hidden`, prefs.notify, () => setPref("notify", !prefs.notify)),
    check("Start when the computer starts", prefs.startAtLogin, () => setPref("startAtLogin", !prefs.startAtLogin)),
    { type: "separator" },
    { label: "Set up Airband in my agents again", click: () => void runSetup(true) },
    { label: 'Forget every "Always allow"', click: () => station.forgetRules() },
    { label: `Airband ${VERSION} on GitHub`, click: () => void shell.openExternal("https://github.com/HarshBaldaniya/airband") },
    { type: "separator" },
    { label: "Quit Airband", accelerator: "CommandOrControl+Q", click: () => app.quit() },
  ];
}

function menu(): void {
  if (!tray) return;
  const s = state;
  const needs = s ? new Set([...s.pending.map((p) => p.chatTitle), ...s.chats.filter((c) => c.status === "waiting").map((c) => c.title)]).size : 0;
  tray.setTitle(needs ? ` ${needs}` : "");
  tray.setToolTip(s?.headline ?? "Airband");
  tray.setContextMenu(Menu.buildFromTemplate(menuItems()));
}

type PrefKey = "sound" | "notify" | "startAtLogin" | "tucked";
const prefsView = () => ({ sound: prefs.sound, notify: prefs.notify, startAtLogin: prefs.startAtLogin, tucked: prefs.tucked });

function setPref(key: PrefKey, on: boolean): void {
  prefs[key] = on;
  savePrefs();
  if (key === "startAtLogin") loginItem();
  win?.webContents.send("prefs", prefsView());
  menu();
}

function loginItem(): void {
  // Only the installed app: a development run would register Electron itself.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.startAtLogin });
}

// ---- telling the person ----

function notify(title: string, body: string): void {
  if (!prefs.notify || !Notification.isSupported()) return;
  // The companion on screen already says it; a notification is for when it is hidden or tucked away.
  if (win?.isVisible() && !prefs.tucked) return;
  const n = new Notification({ title, body, silent: !prefs.sound, icon: nativeImage.createFromBuffer(colorIconPng(128, "#e0a22c")) });
  n.on("click", () => show(true));
  n.show();
}

function onRequest(p: PendingView): void {
  notify(`${p.chatTitle} needs you`, p.detail ? `${p.title}: ${p.detail}` : p.title);
}

/** Each evening at 6 pm, once: what the chats did today. */
function eveningSummary(): void {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getHours() < 18 || prefs.lastSummary === day || !state?.chats.length) return;
  prefs.lastSummary = day;
  savePrefs();
  // A gentle note, never a card that opens by itself: the person asks for the day when they want it.
  notify("Your day in Airband", `${state.headline} Ask ${name()} "what did I do today?" for more.`);
}

/** The companion's eyes follow the pointer: where it is from the figure, from -1 to 1. */
function followCursor(): void {
  let last = "";
  setInterval(() => {
    if (!win?.isVisible() || drag) return;
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const a = prefs.anchor ?? defaultAnchor();
    const fx = a.side === "right" ? b.x + b.width - FIGURE.pad - FIGURE.w / 2 : b.x + FIGURE.pad + FIGURE.w / 2;
    const fy = a.vertical === "bottom" ? b.y + b.height - FIGURE.pad - FIGURE.h / 2 : b.y + FIGURE.pad + FIGURE.h / 2;
    const dx = Math.max(-1, Math.min(1, (c.x - fx) / 320));
    const dy = Math.max(-1, Math.min(1, (c.y - fy) / 240));
    const key = `${dx.toFixed(2)},${dy.toFixed(2)}`;
    if (key !== last) {
      last = key;
      win.webContents.send("cursor", { dx, dy });
    }
  }, 70);
}

async function runSetup(asked = false): Promise<void> {
  try {
    const r = await setup({ fromDir: resources() });
    const agents = r.agents.map((a) => ({ claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" })[a]).join(", ");
    if (asked) {
      const note = r.codexTrust ? "\n\nCodex runs new hooks once you trust them: type /hooks in Codex and trust Airband's." : "";
      void dialog.showMessageBox({ type: "info", message: "Airband is set up", detail: r.lines.join("\n") + note });
    } else if (r.agents.length && Notification.isSupported()) {
      new Notification({ title: "Airband is set up", body: `Your chats in ${agents} now show here.${r.codexTrust ? " In Codex, type /hooks and trust Airband's." : ""}`, icon: nativeImage.createFromBuffer(colorIconPng(128)) }).show();
    }
  } catch (e) {
    void dialog.showMessageBox({ type: "warning", message: "Airband couldn't finish setting up", detail: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * For checking the app without screen access (AIRBAND_DEBUG_DIR only): a file "cmd" there sends its
 * words to the companion's screen, "js" runs in it (the answer in js.out), and "shot" saves the
 * window as shot.png.
 */
function debugHooks(): void {
  const dir = process.env.AIRBAND_DEBUG_DIR;
  if (!dir) return;
  setInterval(() => {
    const cmd = path.join(dir, "cmd");
    if (fs.existsSync(cmd)) {
      const words = fs.readFileSync(cmd, "utf8").trim();
      fs.rmSync(cmd, { force: true });
      if (words === "show") show();
      else win?.webContents.send("command", words);
    }
    const js = path.join(dir, "js");
    if (fs.existsSync(js) && win) {
      const code = fs.readFileSync(js, "utf8");
      fs.rmSync(js, { force: true });
      void win.webContents.executeJavaScript(code).then(
        (r) => fs.writeFileSync(path.join(dir, "js.out"), JSON.stringify(r, null, 2)),
        (e) => fs.writeFileSync(path.join(dir, "js.out"), `error: ${String(e)}`),
      );
    }
    const shot = path.join(dir, "shot");
    if (fs.existsSync(shot) && win) {
      fs.rmSync(shot, { force: true });
      void win.webContents.capturePage().then((img) => {
        fs.writeFileSync(path.join(dir, "shot.png"), img.toPNG());
        fs.writeFileSync(path.join(dir, "shot.json"), JSON.stringify({ bounds: win?.getBounds(), visible: win?.isVisible() }));
      });
    }
  }, 300);
}

// ---- start ----

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Opening the app again (Spotlight, Launchpad, Finder) brings the companion back.
  app.on("second-instance", () => show(true));
  app.whenReady().then(start, (e) => {
    dialog.showErrorBox("Airband couldn't start", String(e));
    app.quit();
  });
}

async function start(): Promise<void> {
  app.setName("Airband");
  if (process.platform === "darwin") app.dock?.hide();
  prefs = { ...prefs, ...readJson<Partial<Prefs>>(prefsFile(), {}) };

  // First start, or an update: Airband's hook, tools and skills go into every agent found.
  // (AIRBAND_SKIP_SETUP: a trial run against a copy of the data, which must not touch the agents.)
  if (!process.env.AIRBAND_SKIP_SETUP && needsSetup()) await runSetup();

  station = new Station({ uiDir: path.join(resources(), "companion") });
  try {
    await station.start();
  } catch (e) {
    dialog.showErrorBox("Airband is already running", `${e instanceof Error ? e.message : String(e)}\n\nStop \`airband station\` in its terminal, then open the app again.`);
    app.quit();
    return;
  }
  station.on("change", (s: StationState) => {
    state = s;
    menu();
  });
  station.on("request", onRequest);
  station.on("finished", (f: { title: string; did?: string }) => notify(`${f.title} finished`, f.did ?? "Have a look when you can."));

  const icon = process.platform === "darwin" ? nativeImage.createFromBuffer(trayIconPng(36), { scaleFactor: 2 }) : nativeImage.createFromBuffer(colorIconPng(32));
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on("click", () => tray?.popUpContextMenu());

  ipcMain.on("hit", (_e, hit: boolean) => win?.setIgnoreMouseEvents(!hit, { forward: true }));
  ipcMain.on("drag-start", (_e, figure: Electron.Rectangle) => {
    if (!win) return;
    const b = win.getBounds();
    drag = { cursor: screen.getCursorScreenPoint(), at: { x: b.x, y: b.y }, figure };
  });
  ipcMain.on("drag-move", () => {
    if (!win || !drag) return;
    const c = screen.getCursorScreenPoint();
    win.setPosition(Math.round(drag.at.x + c.x - drag.cursor.x), Math.round(drag.at.y + c.y - drag.cursor.y));
  });
  ipcMain.on("drag-end", () => {
    const d = drag;
    drag = undefined;
    if (d) settle(d.figure);
  });
  ipcMain.on("hide", hide);
  ipcMain.on("menu", () => Menu.buildFromTemplate(menuItems(true)).popup({ window: win }));
  ipcMain.on("pref", (_e, key: PrefKey, on: boolean) => setPref(key, on));
  ipcMain.handle("prefs", () => prefsView());
  ipcMain.handle("qr", (_e, text: string) => QRCode.toDataURL(text, { margin: 1, width: 264, color: { dark: "#141416", light: "#ffffff" } }));

  globalShortcut.register("Alt+CommandOrControl+R", () => {
    if (!win?.isVisible() || prefs.tucked) show(true);
    else {
      win.focus();
      win.webContents.send("command", "toggle");
    }
  });
  screen.on("display-removed", place);
  screen.on("display-metrics-changed", place);

  createWindow();
  debugHooks();
  loginItem();
  followCursor();
  setInterval(eveningSummary, 60_000);
  menu();
}

app.on("window-all-closed", () => {
  // A menu-bar app: closing the companion's window does not quit it.
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  void station?.stop();
});
