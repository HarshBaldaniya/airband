# Security

Airband runs on your computer. It reads the session files Claude Code, Codex and Gemini CLI keep
in your home folder, writes its own data to `~/.airband`, and, when you turn them on, adds a hook
and a tool server to those agents' settings (backing each file up first). It does not send your
chats anywhere, run a model of its own, or read login or token files.

What it does to stay safe:

- `~/.airband` is readable only by you, and settings files keep their own permissions when
  Airband edits them. A settings file that can't be read is left alone, never replaced.
- Secrets (API keys, tokens, private keys) are removed before anything is recorded or shared.
- What one chat sends another is fenced with a random tag and marked as information, not
  instructions.
- Notes, the Map and backups never follow a symlink out of the project or the backup folder.
- No command line is ever built from chat text: run tasks go to the agent on stdin.
- The MCP server speaks only over stdin and stdout; nothing listens on the network.
- It goes online only for a daily npm version check (hard time limit, size cap, plain version
  numbers only) and, once per language, a parser file that isn't built in: https only, from the
  npm package the build used, and kept only if its SHA-256 matches the one built into Airband.

## Reporting a problem

Please report a vulnerability privately through GitHub: on this repository, open **Security** →
**Report a vulnerability**. Don't open a public issue for it.

Say what you found, how to reproduce it, and what it lets someone do. You'll get a reply within a
week.
