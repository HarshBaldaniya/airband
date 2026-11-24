// Airband was first called Relay, then Crosstalk (renamed before its first release, 0.0.1). People
// who ran those versions still have files, settings, hooks, skills and commands under the old names.
// Airband finds them and moves or replaces them as it sets up, and every old name it looks for is
// listed here.
//
// When to remove: once nobody upgrades from a Crosstalk or Relay install. The easiest sign is a
// release that drops the migration on purpose (a 1.0, say): delete this file and every place that
// imports it. Each of those places only ever adds the old names to a list of Airband's own.

/** Airband's earlier names, oldest first. Replies and notes it wrote begin "[Relay]" or "[Crosstalk]". */
export const OLD_NAMES = ["Relay", "Crosstalk"];

/** The home folders Airband's data lived in: ~/.relay, ~/.crosstalk (and the same in a project). */
export const OLD_HOME_FOLDERS = [".relay", ".crosstalk"];

/** Folders inside the home that were renamed: their contents move to the new name. */
export const RENAMED_FOLDERS: Record<string, string> = { sessions: "flightlogs" };

/** Where readable copies of whole conversations were kept, before flightlogs replaced them. */
export const OLD_CONVERSATIONS_FOLDER = "chats";

/** The programs the old versions copied into their home. Airband writes its own afresh. */
export const OLD_PROGRAMS = ["relay-hook.js", "relay-mcp.js", "crosstalk-hook.js", "crosstalk-mcp.js", "crosstalk.js"];

/** The hook programs the old versions put in agents' settings: still ours, so replaced, never doubled. */
export const OLD_HOOK_PROGRAMS = ["relay-hook.js", "crosstalk-hook.js"];

/** The npm package Airband was first published under (0.0.1 and 0.0.2), and the command it gave. */
export const OLD_NPM_PACKAGES = ["crosstalk-ai"];
export const OLD_COMMAND = "crosstalk";

/** The Claude Code plugin under the old name. Its repository is gone, so it no longer works. */
export const OLD_CLAUDE_PLUGIN = "crosstalk";

/** The tool server and the Codex command list under the old name. */
export const OLD_MCP_SERVERS = ["crosstalk"];
export const OLD_PROMPT_MANIFESTS = [".crosstalk-manifest"];

/** Skills written under the old name, each folder carrying the old name's mark. */
export const OLD_SKILLS = [{ names: ["crosstalk-find-code", "crosstalk-recall", "crosstalk-catchup"], mark: ".crosstalk" }];

/** The Tab completion the old command added to a shell's startup file, and its fish file. */
export const OLD_COMPLETION_MARKS = ["# Crosstalk: Tab completion for the crosstalk command (crosstalk remove takes this out)"];
export const OLD_FISH_FILES = ["crosstalk.fish"];
