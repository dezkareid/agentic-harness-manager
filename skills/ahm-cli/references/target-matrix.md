# Target matrix

Copied verbatim from the README's `## Target matrix` table (a test keeps them in sync).

| Kind | claude-code | codex | antigravity | strands |
|---|---|---|---|---|
| Default strategy | `symlink` | `symlink` | `copy` | `copy` |
| Skills | `.claude/skills/<name>/` | `.agents/skills/<name>/` (directory symlink) | `.agents/skills/<name>/` (shared with codex) | `.agent/skills/<name>/` |
| Context | `AGENTS.md` + `CLAUDE.md` containing `@AGENTS.md` (`override`: rendered `CLAUDE.md` only) | `AGENTS.md`, flattened real file, warns above 32 KiB | `AGENTS.md`, flattened real file | `AGENTS.md`, flattened real file, warns above 16 KiB |
| Hooks | merged into `.claude/settings.json` → `hooks` | merged into `.codex/hooks.json` (same shape); only `SessionStart`, `SessionEnd`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt` and `command`/`mcp_tool` handlers | `.agents/hooks.json` as `{ "<hook file>": { "<Event>": [handlers] } }`; only `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` | generated `ahm_strands.py` `HookProvider`: `PreToolUse`/`PostToolUse` → `BeforeToolCallEvent`/`AfterToolCallEvent` running `command` handlers |
| Subagents | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` (`name`, `description`, `model`, `developer_instructions`) | `.agents/agents/<name>.md` (`tools` passed through with a warning) | generated `Agent(name, description, system_prompt).as_tool()` in `ahm_strands.py` (`AGENT_TOOLS`) |
| Never written | `.claude/commands/` | `~/.codex/prompts` | `.agents/workflows/` | |
| Known limitations | | never follows **file** symlinks, so context is always a real file | symlinks unreliable, so it defaults to `copy` | hooks and agents are code: `ahm_strands.py` is overwritten only with `--force` |

Unsupported events and handler types are reported as `skipped`, never as errors. With several targets, the order is antigravity → strands → codex → claude-code; shared paths (`.agents/skills/*`, `AGENTS.md`) are written once as real files and later targets report `shared`.
