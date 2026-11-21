// The Airband app: a companion in a corner of the screen, and the Station behind it. One process
// runs both. On first start it sets up Airband in Claude Code, Codex and Gemini CLI by itself, so
// the download is the only step. Lives in the menu bar, not the Dock.
//
// The companion's window keeps one size and lets clicks through everywhere except on what it draws,
// so opening a panel or a card never moves or redraws the companion.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import QRCode from "qrcode";
import { airbandFile, readJson, writeFileAtomic } from "../../src/core/paths";
import { appNode, findCommand } from "../../src/core/hooks";
import { needsSetup, setup, VERSION } from "../../src/core/setup";
import { DEFAULT_COMPANION, Station, type StationState } from "../../src/station";
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
  /** The companion has said hello once, on the very first start. */
  greeted: boolean;
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

let prefs: Prefs = { sound: true, notify: true, startAtLogin: true, hidden: false, tucked: false, greeted: false };
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
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, autoplayPolicy: "no-user-gesture-required" },
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

/** A hide in progress: the screen fades out first, then the window goes. */
let leaving: NodeJS.Timeout | undefined;
const LEAVE_MS = 260;

function show(open = false): void {
  clearTimeout(leaving);
  leaving = undefined;
  if (!win) createWindow();
  const wasVisible = win!.isVisible();
  prefs.hidden = false;
  if (open) setPref("tucked", false);
  savePrefs();
  // The window comes back showing its last frame, which a hide left faded out: nothing flashes.
  // Then the screen rises in.
  win!.showInactive();
  if (!wasVisible) win!.webContents.send("command", "arrive");
  if (open) {
    win!.focus();
    win!.webContents.send("command", "open");
  }
  menu();
}

function hide(): void {
  prefs.hidden = true;
  savePrefs();
  menu();
  if (!win?.isVisible()) return;
  // The screen fades out, then the window goes: never a cut.
  win.webContents.send("command", "leave");
  clearTimeout(leaving);
  leaving = setTimeout(() => {
    leaving = undefined;
    if (prefs.hidden) win?.hide();
  }, LEAVE_MS);
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
    check(`${name()} comes back when a chat needs you`, prefs.notify, () => setPref("notify", !prefs.notify)),
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

type PrefKey = "sound" | "notify" | "startAtLogin" | "tucked" | "greeted";
const prefsView = () => ({ sound: prefs.sound, notify: prefs.notify, startAtLogin: prefs.startAtLogin, tucked: prefs.tucked, greeted: prefs.greeted });

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

/**
 * A chat needs you, or finished: the companion comes back on screen if it was hidden or tucked away,
 * and shows the card itself. It never takes the keyboard from what you are typing in. The menu's
 * "comes back when a chat needs you" switch turns this off.
 */
function comeBack(): void {
  if (!prefs.notify) return;
  if (!win?.isVisible() || prefs.hidden) show();
  if (prefs.tucked) setPref("tucked", false);
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
  const eased = { dx: 0, dy: 0 };
  setInterval(() => {
    if (!win?.isVisible() || drag) return;
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const a = prefs.anchor ?? defaultAnchor();
    const fx = a.side === "right" ? b.x + b.width - FIGURE.pad - FIGURE.w / 2 : b.x + FIGURE.pad + FIGURE.w / 2;
    const fy = a.vertical === "bottom" ? b.y + b.height - FIGURE.pad - FIGURE.h / 2 : b.y + FIGURE.pad + FIGURE.h / 2;
    // Far away, the eyes rest ahead and nothing is sent: no work while the pointer is elsewhere.
    const far = Math.hypot(c.x - fx, c.y - fy) > 700;
    const tx = far ? 0 : Math.max(-1, Math.min(1, (c.x - fx) / 360));
    const ty = far ? 0 : Math.max(-1, Math.min(1, (c.y - fy) / 280));
    // Glide a part of the way each step, so the eyes and face drift instead of jumping.
    eased.dx += (tx - eased.dx) * 0.22;
    eased.dy += (ty - eased.dy) * 0.22;
    // Steps of 0.05: the eyes still glide, with a tenth of the updates.
    const key = `${(Math.round(eased.dx * 20) / 20).toFixed(2)},${(Math.round(eased.dy * 20) / 20).toFixed(2)}`;
    if (key !== last) {
      last = key;
      win.webContents.send("cursor", { dx: Math.round(eased.dx * 20) / 20, dy: Math.round(eased.dy * 20) / 20 });
    }
  }, 80);
}

/** Where this app's own `node` goes, for computers with no Node (see appNode). */
const appNodeDir = () => airbandFile("bin");

/** What the hook and the tools run with: the person's own `node`, else this app run as Node. */
function nodeForAgents(): string | undefined {
  return findCommand("node") ?? (app.isPackaged ? appNode(process.execPath, appNodeDir()) : undefined);
}

async function runSetup(asked = false): Promise<void> {
  try {
    const r = await setup({ fromDir: resources(), node: nodeForAgents() });
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
      else if (words === "hide") hide();
      else if (words === "tuck") setPref("tucked", true);
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

// Sounds play from the start, not only after the first click in the window.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Light on the disk: the screen is a few local files, so the web cache stays tiny.
app.commandLine.appendSwitch("disk-cache-size", String(4 * 1024 * 1024));

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
  // Windows shows an app's notifications only under its app id (the installer's shortcut carries it).
  if (process.platform === "win32") app.setAppUserModelId("dev.airband.app");
  if (process.platform === "darwin") app.dock?.hide();
  prefs = { ...prefs, ...readJson<Partial<Prefs>>(prefsFile(), {}) };
  // The hooks already run with this app as Node: point that at where the app is now.
  if (app.isPackaged && ["node", "node.cmd"].some((f) => fs.existsSync(path.join(appNodeDir(), f)))) appNode(process.execPath, appNodeDir());

  // First start, or an update: Airband's hook, tools and skills go into every agent found.
  // (AIRBAND_SKIP_SETUP: a trial run against a copy of the data, which must not touch the agents.)
  if (!process.env.AIRBAND_SKIP_SETUP && needsSetup()) await runSetup();

  // The phone buzzes only when you're away: the screen locked, or no keyboard or mouse for a minute.
  // The phone link is Mac to iPhone only: on Windows the app has none.
  station = new Station({ uiDir: path.join(resources(), "companion"), link: process.platform === "darwin" ? { away: () => powerMonitor.getSystemIdleState(60) !== "active" } : false });
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
  station.on("request", comeBack);
  station.on("finished", comeBack);

  let icon: Electron.NativeImage;
  if (process.platform === "darwin") {
    icon = nativeImage.createEmpty();
    icon.addRepresentation({ scaleFactor: 1, width: 18, height: 18, buffer: trayIconPng(18) });
    icon.addRepresentation({ scaleFactor: 2, width: 36, height: 36, buffer: trayIconPng(36) });
    icon.setTemplateImage(true);
  } else icon = nativeImage.createFromBuffer(colorIconPng(32));
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
