[← Airband](../README.md)

# The desktop app

The desktop app puts Roger, a small companion, in a corner of your screen. He watches every chat in
Claude Code, Codex and Gemini CLI, so you don't have to check each one. The app is built with Tauri
on the system's own web view, so the download is about 3 MB.

## Install in one line

The quickest way: it picks the right file, checks it, installs Airband and opens it.

| Computer | Paste this in |
|---|---|
| Mac (Apple silicon or Intel) | Terminal: `curl -fsSL https://airband.harshbaldaniya.com/install.sh \| sh` |
| Windows 10 or 11 | PowerShell: `irm https://airband.harshbaldaniya.com/install.ps1 \| iex` |

A file fetched this way isn't marked as downloaded by a browser, so there is no warning to click
through and no second start. The scripts are short and readable:
[install.sh](../site/public/install.sh), [install.ps1](../site/public/install.ps1).

## Download

Or get the file from the [website](https://airband.harshbaldaniya.com/download/) or the
[latest release](https://github.com/HarshBaldaniya/airband/releases/latest):

| Computer | File | Size |
|---|---|---|
| Mac with Apple silicon (M1 or later) | `Airband-<version>-Apple-Silicon.dmg` | about 3 MB |
| Mac with an Intel processor | `Airband-<version>-Intel.dmg` | about 3 MB |
| Windows 10 or 11 (64-bit) | `Airband-Setup-<version>.exe` | about 2 MB |

The app isn't signed by Apple or Microsoft yet, so a file downloaded in a browser shows a warning
on its first start. On a Mac ("Airband.app" Not Opened), choose **Done**, then **Open Anyway** in
System Settings → Privacy & Security. Opened from its disk image, Airband offers to move itself to
Applications and starts again from there. On Windows, choose **More info**, then **Run anyway**: the
installer starts Airband when it finishes. It installs for the current user and needs no admin
rights.

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

## Updates

Airband keeps itself current:

- **Its engine updates by itself.** Your agents' tools, skills and Roger's screens follow the newest
  version within a few hours, with nothing to click.
- **The app asks once.** When a newer app is out, Airband's menu shows **Update to Airband x.y.z**,
  and Roger's panel shows **Update**. One click downloads it, checks its signature, and starts the new
  version. No warning to click through, and your settings stay as they are.

Apps from before 0.1.2 can't update themselves: install 0.1.2 once, the same way as the first time.

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
