[← Airband](../README.md)

# The desktop app

The desktop app puts Roger, a small companion, in a corner of your screen. He watches every chat in
Claude Code, Codex and Gemini CLI, so you don't have to check each one. The app is built with Tauri
on the system's own web view, so the download is about 2 MB.

## Download

Get it from the [website](https://airband.harshbaldaniya.com/download/) or the
[latest release](https://github.com/HarshBaldaniya/airband/releases/latest):

| Computer | File | Size |
|---|---|---|
| Mac with Apple silicon (M1 or later) | `Airband-<version>-Apple-Silicon.dmg` | about 2 MB |
| Mac with an Intel processor | `Airband-<version>-Intel.dmg` | about 2 MB |
| Windows 10 or 11 (64-bit) | `Airband-Setup-<version>.exe` | about 1.5 MB |

The app isn't signed yet, so the first start shows a warning. On a Mac, open it once, then choose
**Open Anyway** in System Settings → Privacy & Security. On Windows, choose **More info**, then
**Run anyway**. The Windows installer installs for the current user and needs no admin rights.

If an older download says **"Airband" is damaged and can't be opened**, download it again: releases
from 0.1.1 on are signed so macOS offers Open Anyway instead. To open the copy you have, run
`xattr -cr /Applications/Airband.app` once in Terminal, then open it.

## First start

A short tour sets everything up:

1. It finds the AI coding tools on your computer.
2. It checks Node.js. Airband needs version 20 or newer. If yours is missing or older, the tour can
   fetch its own copy from nodejs.org, which leaves yours as it is.
3. It fetches Airband's engine (the `airband` npm package).
4. It connects your tools.

Every download is checked against its publisher's fingerprint before it runs. Nothing missing stops
the tour: each step says what it needs, and **Continue anyway** still works. Finish later with
**Set up Airband…** in the menu bar (the tray on Windows).

## Using Roger

- **A chat needs you:** Roger hops and shows the request. Choose **Allow**, **Always** or **Deny**,
  or pick an answer to the chat's question. The chat carries on.
- **A chat is done:** he says what it did, and **Review** opens the chat. A turn that hands you the
  next step says "your turn", with what to do.
- **Ask him:** "what's happening?", "what did I do today?", "open the billing chat", "tell the API
  chat that the route changed". If he isn't sure which chat you mean, he asks.
- **Move him** by dragging; he settles against the nearest edge. The **–** button tucks him away.
  Only Roger and his panel take clicks: the rest of his corner lets them through.
- **Show or hide him** anywhere with <kbd>⌥</kbd><kbd>⌘</kbd><kbd>R</kbd> on a Mac, or
  <kbd>Alt</kbd><kbd>Ctrl</kbd><kbd>R</kbd> on Windows.

He sleeps when every chat is done. His name and look are settings.

## Your iPhone

1. In Roger's settings, choose **Link** next to **Your phone**.
2. Scan the code with your iPhone's camera.
3. Add Airband to the Home Screen and open it from there. It links by itself.

Requests and finished chats then reach your Lock Screen with a short summary (iOS 16.4 or later), and
you can answer a request from the iPhone. One iPhone per Mac. Messages are locked end to end, so the
relay that carries them can't read them. See [Privacy and security](privacy.md).

## The menu

Click Airband's icon in the menu bar (Mac) or the tray (Windows), or right-click Roger.

| Item | What it does |
|---|---|
| Show / Hide Roger | Same as the shortcut |
| Tuck Roger away | Small, out of the way |
| Settings… | His name and look, your phone, sounds |
| Sounds | Short sounds for requests and finished chats |
| Roger comes back when a chat needs you | Even when hidden |
| Start at login | On by default |
| Run the setup tour again… | After installing a new AI tool, say |

## Without the app

With no app running, nothing changes: each chat asks in its own terminal, as before.
`airband station` gives the same requests and chats in a browser, on any computer.

## Files

The app keeps two files in `~/.airband`, next to the rest of Airband's data:

| File | What it holds |
|---|---|
| `app.json` | The app's settings |
| `app.log` | What the app did, for when something goes wrong |

The tour's downloads go to `~/.airband/engine` (the engine) and `~/.airband/runtime/node` (its own
Node.js, if it fetched one).

## Uninstall

1. Run `npx airband remove` to take Airband out of every agent (add `--purge` to delete its data).
2. Quit the app from its menu, and turn off **Start at login** first.
3. Mac: move Airband from Applications to the Bin. Windows: Settings → Apps → Airband → Uninstall.

To build the app from source, see [desktop/README.md](../desktop/README.md).
