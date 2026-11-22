[← Airband](../README.md)

# The airband command and settings

Everything Airband does can be run from a terminal, and its settings can be changed without VS Code.

## Commands

| Command | What it does |
|---|---|
| `airband` | Show what each agent has, and set up anything missing |
| `airband doctor` | Check that everything works, with the exact fix for anything that doesn't |
| `airband update` | Move to the newest version and refresh every agent (`--check` only looks) |
| `airband remove` | Take Airband out of every agent (`--purge` also deletes its data) |
| `airband notices off` | Hide Airband's lines in your agent's window (`on` shows them again) |
| `airband find "rate limiter"` | Where something is in your code; also `outline`, `graph`, `overview` |
| `airband diff #128` | What a pull request or branch changed: functions, their callers, the tests |
| `airband standup` | What your chats did since yesterday, in every project (`--days 7` for a week) |
| `airband spend` | Tokens spent by project, agent, ticket and chat (`--days 30`) |
| `airband writing` | The writing rules agents get; `writing check <file>` checks a doc |
| `airband changelog` | What changed in this version (`--all` for every version) |
| `airband about` | Version, system, where it is installed, and the links |
| `airband bug` | Open a GitHub issue with your version and system filled in |
| `airband help <command>` | Options and examples for any command |

`status`, `doctor`, `version` and `about` take `--json`. Setup takes `--agents claude,codex`,
`--no-sharing`, `--no-command`, `--completion` and `--verbose`.

<details>
<summary><strong>Tab completion</strong></summary>

Setup asks once whether to turn it on for zsh, bash or fish. For PowerShell, add
`airband completion powershell | Out-String | Invoke-Expression` to your `$PROFILE`.
`airband remove` takes it out again.
</details>

<details>
<summary><strong>Updates</strong></summary>

Airband checks npm for a newer version at most once a day and says so in one line; it never updates
by itself. The check is off in CI, and with `AIRBAND_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1`.
</details>

<details>
<summary><strong>The Map without VS Code</strong></summary>

For CI and cloud agents:

```bash
airband find "rate limiter"        # ranked matches, path:start-end
airband outline src/api/limits.ts  # one level of a file or folder
airband graph RateLimiter          # who uses it, what it uses
airband diff #128                  # what a PR changed, who calls it, which tests reach it
airband check docs                 # exits 1 when a doc names code that is gone
```

`--in <folder>` points it at another project, and so does the name of one already mapped
(`--in my-api`). The parsers for TypeScript, JavaScript and Python are
built in; Go, Rust, Java, C#, Ruby and PHP are downloaded once, the first time a project has them,
and used only if they match a fingerprint built into Airband.
</details>

## Configuration

Settings live under **Settings → Extensions → Airband**:

| Setting | Default | What it does |
|---|---|---|
| `airband.contextSize` | `"standard"` | How much of a chat another chat receives when they are first connected: `compact` (~2k tokens), `standard` (~6k) or `full` (~15k). The rest is always in its flightlog. |
| `airband.autoDeliver` | `false` | Give waiting updates to a chat as soon as it finishes, at the cost of an extra turn. Off: they wait for your next message, at no extra cost. |
| `airband.codeMap.enabled` | `true` | Keep a Map of each open folder (about 1 MB for a large project). |
| `airband.notices` | `true` | Show Airband's line when a chat starts and when other chats' work is added to your message. Shown to you only; no tokens. |
| `airband.writing.docs` | `true` | Add the docs writing rules when a chat is asked for a doc, and check docs agents write. |
| `airband.writing.messages` | `true` | Add the message writing rules when a chat is asked for a message. |
| `airband.writing.beforeSend` | `true` | Check a message, PR or commit before an agent sends it, and hold it once to fix. |
| `airband.writing.replies` | `false` | Ask every chat for short replies you can act on. |
| `airband.backupFolder` | `""` | A folder to copy flightlogs and your own commands to every half hour, for example in iCloud Drive or Dropbox. |

Without VS Code, the same choices are commands: `airband notices off`, `airband writing replies on`.
A project's `.airband.json` sets the writing rules for everyone who works in it.

<details>
<summary><strong>Keyboard shortcuts</strong></summary>

| Keys | Where | Action |
|---|---|---|
| `T` `U` `M` `C` `E` | Everywhere | Tower, Fuel, Map, Commands, Writing |
| `/` | Tower, Map, Commands | Find a chat, a file or a command |
| `N` | Tower | New Claude chat |
| `1` `2` `3` `4` | Tower | Arrange by channel, time, agent, folder |
| `0` | Tower, Map | Fit everything in view |
| `F` | Tower, Fuel | Focus mode |
| `Esc` | Everywhere | Close, clear or step back |

Press `?` on any page for the full list.
</details>
