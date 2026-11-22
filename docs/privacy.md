[← Airband](../README.md)

# Privacy and security

Airband runs on your computer. Nothing leaves it unless you link an iPhone, and then only messages locked so the relay can't read them.

- **The desktop companion sees your chats' records in Airband and nothing else.** It never opens
  your files, folders, screen or clipboard. Asked to, it says so and asks which chat to look in.
- **Look things up is one switch.** With it on (it starts on), the companion passes a question it
  can't answer itself to Claude Code. A question about your chats gets only Airband's read-only
  flightlog. Any other question gets only web search. Neither gets file or shell tools or your other
  connections, and nothing of it is saved as a chat. A question that asks to read your files or
  folders is refused.
- **The app listens on this computer only,** never on your network.
- **Your iPhone link is yours alone.** The code works once, for 10 minutes, and the first iPhone to
  use it gets a secret of its own; the code is then deleted, so a photo of it is worth nothing. One
  iPhone per Mac. Messages pass through Airband's relay (a Cloudflare Worker, `relay/` in this
  repository) locked with that secret, so the relay can't read them. It keeps only the latest locked
  state and deletes a room unused for 30 days. Alerts go from your Mac to Apple's push service,
  locked for your iPhone. Your iPhone gets no folder paths, and it can answer requests and nothing
  else.
- **The relay costs nothing.** It runs on Cloudflare's free plan, which never charges: past the daily
  limit it stops until the next day. Your Mac sends its state only while the iPhone app is open, at
  most once a second and 3,000 times a day.
- **Nothing is sent anywhere by Airband,** unless you link an iPhone (above). It reads the session
  files your agents already write and keeps its own data in `~/.airband`, readable only by you. No
  account, no telemetry.
- **Online for two things only,** besides a linked iPhone: a daily npm version check, and a language
  parser the first time a project needs one. `AIRBAND_OFFLINE=1` turns both off.
- **Secrets stay out.** API keys, tokens and private keys pasted into a chat are removed before
  anything is recorded, shared or returned by a tool.
- **Shared text is data, not orders.** What one chat sends another is fenced with a random tag and
  marked as information, so words in it can't pass for your instructions.
- **No logins.** Airband never reads a login, token or key file.
- **Standups, spend and the writing check stay on your computer.** They read the records Airband
  already keeps and the files agents write. Nothing is uploaded.
- **Changes only Airband's own entries** in each agent's settings, after a backup; `airband remove`
  takes them all out again.

What one chat shares with another becomes part of the receiving chat, so it goes to that agent's
provider like anything else you type there. To report a vulnerability, see [SECURITY.md](../SECURITY.md).
