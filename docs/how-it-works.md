[← Airband](../README.md)

# How it works

Airband runs on your computer, next to your agents. It has no server and no account.

Airband sits beside your agents. It reads the session files they already write, keeps its own short
records, and reaches each agent through two standard doors every agent has: a **hook** that runs after
each reply, and an **MCP server** with the tools above.

```mermaid
flowchart LR
    AGENTS["Your agents<br/>Claude Code · Codex · Gemini CLI"]
    SESSIONS[("Their own<br/>session files")]

    subgraph airband["Airband, on your computer"]
        HOOK["Hook<br/>runs after each reply"]
        MCP["MCP server<br/>map · flightlog · notes"]
        HOME[("~/.airband<br/>flightlogs · channels · inboxes · map")]
        EXT["VS Code extension<br/>Tower · Fuel · Map · Commands"]
    end

    AGENTS -->|write| SESSIONS
    AGENTS -->|after each reply| HOOK
    AGENTS <-->|tools| MCP
    HOOK -->|records and delivers| HOME
    MCP --- HOME
    EXT -->|reads| SESSIONS
    EXT --- HOME
```

## When two chats are connected

```mermaid
sequenceDiagram
    autonumber
    participant A as Chat A (adds rate limiting)
    participant H as Airband hook
    participant L as ~/.airband
    participant B as Chat B (writes the tests)

    A->>H: reply finished
    H->>L: add A's new asks to its flightlog
    H->>L: leave a note in B's inbox (Ping, Brief or Full)
    Note over B: later, you send B a message
    B->>H: message about to be sent
    H->>L: take what is waiting in B's inbox
    H-->>B: your message goes in with A's note
```

The note arrives with the next message you were sending anyway, so it costs no extra turn. The words
are fenced and marked as information from another chat, never as instructions.

## What `npx airband` does

```mermaid
flowchart TD
    START(["npx airband"]) --> FIND{"Which agents are<br/>on this computer?"}
    FIND --> CLAUDE["Claude Code<br/>tools · skills · hook · allow rule"]
    FIND --> CODEX["Codex<br/>tools · skills · hook · prompts"]
    FIND --> GEMINI["Gemini CLI<br/>tools · hook"]
    CLAUDE & CODEX & GEMINI --> BACKUP["Each settings file<br/>backed up before the change"]
    BACKUP --> CMD["Adds the airband command<br/>with the same package manager"]
    CMD --> DONE(["airband doctor:<br/>Everything works"])
```

Run it again any time: it changes nothing that is already right, and replaces only Airband's own
entries.
