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
- No command line is ever built from chat text.
- The desktop app installs an engine only when it carries Airband's own signature from the GitHub
  release, as well as npm's fingerprint.
- Only Airband's own pages reach the Station, the local server Roger talks to: other pages, other
  host names and plain forms are refused.
- The MCP server speaks only over stdin and stdout; nothing listens on the network.
- It goes online only for a daily npm version check (hard time limit, size cap, plain version
  numbers only) and, once per language, a parser file that isn't built in: https only, from the
  npm package the build used, and kept only if its SHA-256 matches the one built into Airband.

## How the repository is protected

- Every change reaches `main` through a pull request that the owner approves. A commit pushed after
  an approval needs a new one.
- The tests on Ubuntu, macOS and Windows must pass, and CodeQL must find no high or critical
  security problem.
- Nobody can force-push to `main` or delete it. Only the owner can create, move or delete a release
  tag.
- A pull request from a fork runs its checks only after the owner approves the run, and never gets
  the repository's secrets.
- Workflows may use only GitHub's own actions and two named Rust actions, each pinned to an exact
  commit.
- Secret scanning blocks a push that contains a key. Dependabot reports vulnerable dependencies
  and opens a pull request to fix each one.

## Reporting a problem

Please report a vulnerability privately through GitHub: on this repository, open **Security** →
**Report a vulnerability**. Don't open a public issue for it.

Say what you found, how to reproduce it, and what it lets someone do. You'll get a reply within a
week.
