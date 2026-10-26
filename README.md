# agentic-harness-manager

`ahm` exports one **agentic harness** (skills, context files, hooks and subagents) into the on-disk layout each coding agent expects: **Claude Code**, **Codex CLI**, **Antigravity** and **Strands**. You keep a single source of truth, and `ahm` links, copies or renders it per target. Tag blocks let one file say different things to different agents.

## Installation

```bash
npm i -g @dezkareid/agentic-harness-manager
ahm --help
```

Or run it without installing:

```bash
npx @dezkareid/agentic-harness-manager --help
```

Requires Node.js 24 or later.

## Quick start

```bash
ahm init                                   # writes a commented ahm.config.json
mkdir -p harness/skills/code-review        # add your harness (see layout below)
$EDITOR harness/skills/code-review/SKILL.md
ahm list                                   # preview: item × target × strategy × destination
ahm export                                 # write the target trees
ahm export --target codex,antigravity      # one-off target selection
```

## Harness source layout

```text
harness/
├── skills/<name>/SKILL.md   # + optional references/, scripts/, assets/
├── context/AGENTS.md        # canonical context file (other *.md allowed, @imports supported)
├── hooks/*.json             # Claude-shaped { "hooks": { "<Event>": [...] } }
└── agents/<name>.md         # YAML frontmatter (name, description, tools?, model?) + body
```

- **Skills** follow the [Agent Skills](https://agentskills.io) frontmatter rules. `description` is required (up to 1024 chars). `name` defaults to the folder name, must match it, and must be lowercase letters, numbers and single hyphens, up to 64 characters. Unknown keys are preserved.
- **Agents** need `name` and `description`; `tools` (string or list) and `model` are optional.
- **Hooks** use the Claude Code `settings.json` shape. Each target converts them as described in the target matrix.
- **Context**: a line containing only `@relative/path.md` imports another file. Claude Code resolves it natively; other targets get the text inlined.

An invalid file fails the whole load with every offending path listed. Empty folders only produce warnings.

## Commands

```bash
ahm export [--target <ids>] [--out <dir>] [--strategy symlink|copy|override] [--omit <selector>...] \
           [--tag <tag>...] [--dry-run] [--force] [--no-symlink] [--config <path>] [--format table|json]
ahm list   [--target <ids>] [--out <dir>] [--strategy <name>] [--omit ...] [--tag ...] [--config <path>] [--format table|json]
ahm init   [--force]
ahm --version | --help | <command> --help
```

| Flag | Meaning |
|---|---|
| `-t, --target <ids>` | `claude-code`, `codex`, `antigravity`, `strands`; comma-separated or repeated. Replaces the config's `targets` |
| `-o, --out <dir>` | output directory (overrides every `outputDir`) |
| `-s, --strategy <name>` | strategy for every item |
| `--omit <selector>` | skip items, repeatable: `kind:glob` (`hook:*`, `skill:internal-*`) or a name glob |
| `--tag <tag>` | extra active tag for override blocks, repeatable |
| `--dry-run` | print exactly what `export` would do, including `skipped` reasons, without writing |
| `--force` | replace destinations that differ from the harness |
| `--no-symlink` | copy instead of creating symlinks |
| `-c, --config <path>` | use this config file |
| `-f, --format table\|json` | `json` prints one array of `{ target, kind, name, strategy, action, dest, reason }` |
| `-q, --quiet` / `-v, --verbose` | hide progress / add debug output (global flags, before the command) |

`ahm list` is `ahm export --dry-run`. `ahm init` writes a commented starter `ahm.config.json` and refuses to overwrite one without `--force`.

Each report entry has an **action**: `linked`, `copied`, `rendered`, `merged`, `shared` (another target already wrote that path), `skipped` (with a reason) or `failed`.

| Exit code | Meaning |
|---|---|
| `0` | success |
| `1` | validation or config error (bad flag, invalid config, invalid harness, no targets) |
| `2` | export errors: some items `failed`, the rest were exported |
| `130` | interrupted (Ctrl+C) |

## Configuration

Config is discovered in this order (first match wins): `--config <path>`, `ahm.config.json` (comments allowed), `ahm.config.yaml`, the `"ahm"` key in `package.json`, then built-in defaults.

```jsonc
{
  "source": "./harness",
  "outputDir": ".",
  "targets": ["claude-code", { "id": "codex", "omit": ["hook:*"] }],
  "defaultStrategy": "symlink",
  "omit": ["skill:internal-*"],
  "overrides": { "context:AGENTS.md": { "strategy": "override", "tags": ["team"] } }
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `source` | string | `./harness` | harness folder |
| `outputDir` | string | `.` | root the target trees are written to |
| `targets` | `(TargetId \| { id, outputDir?, strategy?, tags?, omit? })[]` | `[]` | `TargetId`: `claude-code`, `codex`, `antigravity`, `strands` |
| `defaultStrategy` | `symlink \| copy \| override` | per target | unset → each target's default (see matrix) |
| `omit` | selector[] | `[]` | items to skip everywhere |
| `overrides` | `Record<selector, { strategy?, tags?, outputDir? }>` | `{}` | per-item settings |

- A **selector** is `kind:glob` (`skill:internal-*`, `hook:*`) or a bare glob matched against the item name (`AGENTS.md`). `*` and `?` are supported.
- Relative paths in the config resolve against the config file's directory; CLI paths resolve against the working directory.
- **Precedence** for `strategy` and `outputDir`: CLI flags > per-target config > per-item override (the last matching selector wins) > global config > target defaults.
- `tags` and `omit` **accumulate** across every level. Each target id is always an active tag, so `<!-- ahm:tag:codex -->` works without config.
- Validation errors name the offending key path, e.g. `targets[1].strategy`. Unknown keys are rejected.

## Strategies

- **`symlink`**: relative symlink to the source. Skills are linked as **whole directories**, because Codex follows directory symlinks but never file symlinks. If the filesystem refuses (`EPERM`, `ENOTSUP`, …), `ahm` warns and copies instead; `--no-symlink` always copies.
- **`copy`**: recursive copy that keeps file permissions, so skill scripts stay executable.
- **`override`**: renders `.md`/`.json` files through tag blocks for the active tags and always writes real files, even when everything else is symlinked. Other files are copied unchanged.

Tag markers must sit on their own line:

```markdown
<!-- ahm:tag:codex,antigravity -->
Only rendered for Codex and Antigravity.
<!-- /ahm:tag -->

<!-- ahm:omit -->
Never exported (maintainer notes).
<!-- /ahm:omit -->

<!-- ahm:only:claude-code --> - This line is only kept for Claude Code.
```

Nested or unbalanced blocks fail that item with the file path and line number (exit code 2). Unknown `ahm:` markers are left untouched. Markers inside JSON string values are not supported; hooks go through per-target transforms instead.

**Idempotency**: re-running is safe. A symlink that already points at the same source, or a file with identical content, is `skipped (unchanged)`. A destination that differs is `skipped (exists)` and is only replaced with `--force`. Hook files (`settings.json`, `hooks.json`) are merged, never clobbered, and need no `--force`.

## Target matrix

| Kind | claude-code | codex | antigravity | strands |
|---|---|---|---|---|
| Default strategy | `symlink` | `symlink` | `copy` | `copy` |
| Skills | `.claude/skills/<name>/` | `.agents/skills/<name>/` (directory symlink) | `.agents/skills/<name>/` (shared with codex) | `.agent/skills/<name>/` |
| Context | `AGENTS.md` + `CLAUDE.md` containing `@AGENTS.md` (`override`: rendered `CLAUDE.md` only) | `AGENTS.md`, flattened real file, warns above 32 KiB | `AGENTS.md`, flattened real file | `AGENTS.md`, flattened real file, warns above 16 KiB |
| Hooks | merged into `.claude/settings.json` → `hooks` | merged into `.codex/hooks.json` (same shape); only `SessionStart`, `SessionEnd`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt` and `command`/`mcp_tool` handlers | `.agents/hooks.json` as `{ "<hook file>": { "<Event>": [handlers] } }`; only `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` | generated `ahm_strands.py` `HookProvider`: `PreToolUse`/`PostToolUse` → `BeforeToolCallEvent`/`AfterToolCallEvent` running `command` handlers |
| Subagents | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` (`name`, `description`, `model`, `developer_instructions`) | `.agents/agents/<name>.md` (`tools` passed through with a warning) | generated `Agent(name, description, system_prompt).as_tool()` in `ahm_strands.py` (`AGENT_TOOLS`) |
| Never written | `.claude/commands/` | `~/.codex/prompts` | `.agents/workflows/` | |
| Known limitations | | never follows **file** symlinks, so context is always a real file | symlinks unreliable, so it defaults to `copy` | hooks and agents are code: `ahm_strands.py` is overwritten only with `--force` |

Unsupported events and handler types are reported as `skipped`, never as errors.

When several targets are selected they run in the order antigravity → strands → codex → claude-code. Paths shared between targets (`.agents/skills/*`, `AGENTS.md`) are written once as real files, and later targets report `shared`. Context files that are only pulled in through an `@` import are skipped by the flattening targets (`inlined into the importing context file`) and still exported for claude-code.

Using the generated Strands stub:

```python
from strands import Agent
from ahm_strands import AhmHooks, AGENT_TOOLS

agent = Agent(hooks=[AhmHooks()], tools=[*AGENT_TOOLS])
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `skipped (exists)` and a warning to re-run with `--force` | the destination differs from the harness (local edits or a stale copy). Check it, then `ahm export --force` |
| `warn: … cannot create symlink (EPERM), copying instead` | the filesystem or OS refuses symlinks (Windows without Developer Mode, some network drives). Enable Developer Mode or use `--no-symlink` / `"defaultStrategy": "copy"` |
| An item shows `skipped (omitted)` | an `omit` selector matched it in the config, a target entry or `--omit`. Run `ahm list` to see which items are affected |
| Hooks show `skipped (event X not supported by …)` | that agent has no equivalent event. Expected; the other events are still exported |
| `failed` with `nested ahm block` / `never closed` | fix the tag blocks at the reported line; markers must be on their own line |
| `Invalid harness:` with a list of paths | fix the listed files (missing `SKILL.md`, bad frontmatter, invalid hook JSON) |
| `Invalid config in …` | the message names the key path, e.g. `targets[0]`; unknown keys are rejected |
| `No targets selected` | pass `--target` or set `targets` in the config |
| Claude Code ignores `AGENTS.md` | Claude reads `AGENTS.md` only through `CLAUDE.md`; make sure `CLAUDE.md` contains `@AGENTS.md` (re-run with `--force` if you had your own) |
| Codex does not see a skill | Codex follows directory symlinks only; do not symlink individual files by hand |

Add `--verbose` (before the command: `ahm -v export`) to see which config file and source folder were used.

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
```

Releases are automated with semantic-release from `main` (see [AGENTS.md](./AGENTS.md#ci-configuration)).
