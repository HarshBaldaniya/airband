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

1. It finds the AI coding tools on your computer. With none yet, it shows Claude Code, Codex and
   Gemini CLI, each linked to its official website, and finds one as soon as it is installed.
2. It checks Node.js. Airband needs version 20 or newer. If yours is missing or older, the tour can
   fetch its own copy from nodejs.org, which leaves yours as it is.
3. It fetches Airband's engine (the `airband` npm package). It installs it only once it checks out
   against Airband's signature. If it doesn't, the tour says so, and **Check again** tries again.
4. It connects your tools.

Every download is checked against its publisher's fingerprint before it runs. Nothing missing stops
the tour: each step says what it needs, and **Continue anyway** still works. Finish later with
**Set up Airband…** in the menu bar (the tray on Windows).

## Using Roger

- **A chat needs you:** Roger hops and shows the request. Choose **Allow**, **Always** or **Deny**,
  or pick an answer to the chat's question. The chat carries on.
- **A chat is done:** he says what it did, and **Review** opens the chat. A turn that hands you the
  next step says "your turn", with what to do.
- **Open a chat** from his panel (or **Review** on a finished one). It opens where it lives:
  - Running in Terminal or iTerm: its own tab comes forward.
  - Running in VS Code: its window, with that exact Claude Code chat.
  - Running in the Claude app's Code tab, or last used there: the Claude app, with that chat.
  - A Codex chat from the Codex app: the Codex app, with that chat.
  - A Claude Code chat that isn't running, with its folder open in VS Code: that same window.
  - A Claude Code chat the Claude app lists: the Claude app.
  - Anything else: it is resumed in a new Terminal window.
  He never opens a second VS Code window, or another editor. The first time he brings a Terminal tab
  forward, macOS asks to let Airband control Terminal. Choose **Allow**.
- **Chats in the Claude app and the Codex app count too.** Roger hears about a chat from its hooks.
  If a chat's hooks don't run, he reads its file as it changes. It still shows as working, then
  done, and he says what it did. Chats in the Claude app's Chat tab are kept online, not on your
  computer, so Roger can't see them.
- **Message a chat** that is working: the message goes in after its next step (Claude Code, Gemini
  CLI) or before it stops (Codex). The Message button shows only on working chats.
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
| Update to Airband x.y.z | Shown when a newer app is out: downloads it and starts it (see [Updates](#updates)) |
| Set up Airband… | Shown until the setup tour is finished: opens it |
| Show / Hide Roger | Same as the shortcut |
| Tuck Roger away | Small, out of the way |
| Settings… | His name and look, your phone, sounds |
| Sounds | Short sounds for requests and finished chats |
| Roger comes back when a chat needs you | When a chat needs you or finishes, even when hidden |
| Start at login | On by default |
| Run the setup tour again… | After installing a new AI tool, say |
| Uninstall Airband… | Takes Airband out of everything (see [Uninstall](#uninstall)) |
| Quit Airband | Stops Roger and the engine the app started |

## Without the app

With no app running, nothing changes: each chat asks in its own terminal, as before.
`airband station` gives the same requests and chats in a browser, on any computer.

## Updates

Airband keeps itself current:

- **Its engine updates by itself.** Your agents' tools, skills and Roger's screens follow the newest
  version within a few hours, with nothing to click. Each engine is checked twice before it is
  installed: against npm's fingerprint, and against Airband's own signature on the GitHub release of
  that version. An engine that fails either check isn't installed.
- **The app asks once.** When a newer app is out, Airband's menu shows **Update to Airband x.y.z**,
  and Roger's panel shows **Update**. One click downloads it, checks its signature, and starts the new
  version. No warning to click through, and your settings stay as they are.

Apps from before 0.1.2 can't update themselves: install 0.1.2 once, the same way as the first time.

## Files

The app keeps these files in `~/.airband`, next to the rest of Airband's data:

| File | What it holds |
|---|---|
| `app.json` | The app's settings |
| `app.log` | What the app did, for when something goes wrong |
| `engine.log` | What the engine reported as it ran, for the same |
| `updated.json` | The version an update put in place, until the new app has said so |

The tour's downloads go to `~/.airband/engine` (the engine) and `~/.airband/runtime/node` (its own
Node.js, if it fetched one).

## Uninstall

Choose **Uninstall Airband…** in the menu. It takes out everything Airband added:

- its skills, hooks and tools in Claude Code, Codex and Gemini CLI
- the `airband` command
- Start at login, and the app itself (to the Bin on a Mac)

**Keep my data** keeps your chat records and the map in `~/.airband`. **Remove everything** moves
them to the Bin too.

On Windows, **Settings → Apps → Airband → Uninstall** does the same. Tick **Delete the application
data** to remove `~/.airband` too.

Moving the app to the Bin by hand leaves Airband in every agent. To take it out then, run
`npx airband remove --command` (add `--purge` to delete `~/.airband`).

To build the app from source, see [desktop/README.md](../desktop/README.md).
