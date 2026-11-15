# Give your agents the map and commands

**Set up my agents** gives Claude Code, Codex and Gemini CLI three small tools (each agent's settings
are backed up first):

- `airband_map`: find code by name or meaning, see what uses what, outline a file.
- `airband_flightlog`: what another chat asked and did.
- `airband_notes`: notes chats leave for the project.

…and the **Commands**: `/airband:plan`, `/airband:review`, `/airband:pr` and more in Claude Code
(`/prompts:…` in Codex, `/…` in Gemini CLI).

**Remove the toolkit from my agents** undoes it.
