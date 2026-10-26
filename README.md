# agentic-harness-manager
Package to export harness (context, skills, hooks, subagents, etc) to different agents/tools allowing override sections

## Installation

```bash
npm i -g @dezkareid/agentic-harness-manager
ahm --help
```

Or run it without installing:

```bash
npx @dezkareid/agentic-harness-manager --help
```

## Configuration

Config is discovered in this order (first match wins): `--config <path>`, `ahm.config.json` (comments allowed), `ahm.config.yaml`, the `"ahm"` key in `package.json`, then built-in defaults. `ahm init` writes a commented starter `ahm.config.json` (use `--force` to overwrite).

| Key | Type | Default |
|---|---|---|
| `source` | string | `./harness` |
| `outputDir` | string | `.` |
| `targets` | `(TargetId \| { id, outputDir?, strategy?, tags?, omit? })[]` | `[]` |
| `defaultStrategy` | `symlink \| copy \| override` | per target |
| `omit` | selector[] | `[]` |
| `overrides` | `Record<selector, { strategy?, tags?, outputDir? }>` | `{}` |

- `TargetId` is `claude-code`, `codex`, `antigravity` or `strands`.
- A **selector** is `kind:glob` (`skill:internal-*`, `hook:*`) or a bare glob matched against the item name (`AGENTS.md`). `*` and `?` are supported.
- Relative paths in the config resolve against the config file's directory; CLI paths resolve against the working directory.

**Precedence** for `strategy` and `outputDir`: CLI flags > per-target config > per-item override (last matching selector wins) > global config > defaults. Per-target default strategies: `claude-code`/`codex` → `symlink`, `antigravity`/`strands` → `copy`.

`tags` and `omit` accumulate across every level instead of replacing each other. Each target id is always an active tag, so `<!-- ahm:tag:codex -->` works without config.

Validation errors name the offending key path, e.g. `targets[1].strategy`.

## Export Strategies

A strategy turns one harness item into files in a target tree (`src/strategies/`). Each implements `apply(item, destPath, ctx) → { action: 'linked' | 'copied' | 'rendered' | 'skipped', reason? }`.

- **`symlink`** (default for `claude-code` and `codex`): relative symlink to the source. Skills are linked as **whole directories**, because Codex follows directory symlinks but never file symlinks. If the filesystem refuses (`EPERM`, `ENOTSUP`, …) it warns and copies instead; `--no-symlink` always copies.
- **`copy`** (default for `antigravity` and `strands`): plain recursive copy.
- **`override`**: renders `.md`/`.json` files through tag blocks and always writes real files, even when the global strategy is `symlink`. Other files are copied unchanged.

Tag markers must be on their own line:

```markdown
<!-- ahm:tag:codex,antigravity -->
Only rendered for Codex and Antigravity.
<!-- /ahm:tag -->

<!-- ahm:omit -->
Never exported.
<!-- /ahm:omit -->

<!-- ahm:only:claude-code --> - This line is only kept for Claude Code.
```

Nested or unbalanced blocks fail with the file path and line number. Unknown `ahm:` markers are left untouched. Markers inside JSON string values are not supported; hooks use per-target transforms instead.

**Idempotency**: re-running is safe. A symlink that already points at the same source, or a file with identical content, is reported as `skipped (unchanged)`. A destination that differs is reported as `skipped (exists)` and only replaced with `--force`.

## Targets

A target maps harness items onto the layout an agent expects (`src/targets/`). It implements `Target`: `id`, `defaultStrategy`, `supports(kind)`, `layout(item, ctx) → { destPath, mode: 'dir' | 'file' | 'merge' }`, and optional `transform` (custom output for an item) and `postProcess` (runs once per target, e.g. to merge hooks). The engine in `src/export/run.ts` (`exportHarness`) resolves per-item settings, skips omitted or unsupported items, applies the strategy or transform, and refuses to write outside the resolved `outputDir`.

### claude-code (default strategy `symlink`)

| Kind | Output |
|---|---|
| skills | `.claude/skills/<name>/` (directory) |
| agents | `.claude/agents/<name>.md` |
| context | `AGENTS.md` plus a `CLAUDE.md` containing `@AGENTS.md`. With `override`, a rendered `CLAUDE.md` only |
| hooks | merged into `.claude/settings.json` → `hooks` (deep-merged by event, identical entries deduped, other keys untouched, no `--force` needed) |

Legacy `.claude/commands/` is never written, because skills supersede commands.

### codex (default strategy `symlink`)

| Kind | Output |
|---|---|
| skills | `.agents/skills/<name>/`. Directory symlinks only, because Codex never follows file symlinks |
| context | `AGENTS.md` as a real file with `@` imports inlined; warns above 32 KiB |
| hooks | merged into `.codex/hooks.json` (Claude shape). Only the 12 Codex events and `command`/`mcp_tool` handlers are kept; the rest are reported `skipped` |
| agents | `.codex/agents/<name>.toml` with `name`, `description`, `model`, `developer_instructions` (the body) |

### antigravity (default strategy `copy`)

| Kind | Output |
|---|---|
| skills | `.agents/skills/<name>/`, the same directory as Codex. When both run into the same `outputDir`, it is written once and Codex reports `shared` |
| context | `AGENTS.md` (flattened) |
| hooks | `.agents/hooks.json` as `{ "<hook-file-name>": { "<Event>": [handlers] } }`, with each group's `matcher` copied onto its handlers. Only `SessionStart`, `PreToolUse`, `PostToolUse` and `Stop` are kept; other hook names in the file are preserved |
| agents | `.agents/agents/<name>.md`. `tools` are passed through with a warning that ids differ |

Deprecated `.agents/workflows/` is never written.

### strands (default strategy `copy`)

| Kind | Output |
|---|---|
| skills | `.agent/skills/<name>/` (singular, the harness default scan dir); names must be lowercase/hyphens, at most 64 chars |
| context | `AGENTS.md` (flattened); warns above 16 KiB |
| hooks + agents | generated `ahm.strands.py`: an `AhmHooks(HookProvider)` running `PreToolUse`/`PostToolUse` commands on `BeforeToolCallEvent`/`AfterToolCallEvent` via `subprocess`, and one `Agent(name, description, system_prompt).as_tool()` per agent collected in `AGENT_TOOLS`. Overwritten only with `--force` |

### Multiple targets

Targets run in the order antigravity → strands → codex → claude-code, so destinations shared between targets (`.agents/skills/*`, `AGENTS.md`) are written once as real files. Later targets report `shared`. `@path` lines in context files are inlined for every target except claude-code, which supports imports natively.

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
```

Releases are automated with semantic-release from `main` (see [AGENTS.md](./AGENTS.md#ci-configuration)).

## CLI Usage

```bash
ahm export [--target <ids>] [--out <dir>] [--strategy symlink|copy|override] [--omit <selector>...] \
           [--tag <tag>...] [--dry-run] [--force] [--no-symlink] [--config <path>] [--format table|json]
ahm list   [--target <ids>] [--out <dir>] [--strategy <name>] [--omit ...] [--tag ...] [--config <path>] [--format table|json]
ahm init   [--force]
ahm --version | --help | <command> --help
```

- `--target` takes comma-separated ids and can be repeated: `--target claude-code,codex --target strands`.
- `list` prints the plan (item × target × strategy × destination) without writing; `export --dry-run` prints exactly what `export` would do, including `skipped` reasons.
- `--format json` prints a single JSON array of entries (`target`, `kind`, `name`, `strategy`, `action`, `dest`, `reason`) for scripting.
- Global flags: `-q, --quiet` hides progress (command output, warnings and errors still print); `-v, --verbose` adds debug lines on stderr. Colors are only used on a TTY and are disabled by `NO_COLOR`.

| Exit code | Meaning |
|---|---|
| `0` | success |
| `1` | validation or config error (bad flag, invalid config, invalid harness, no targets) |
| `2` | export errors: some items `failed`; the others were still exported |
| `130` | interrupted (Ctrl+C) |

## Harness source layout

```text
harness/
├── skills/<name>/SKILL.md   # + optional references/, scripts/, assets/
├── context/AGENTS.md        # canonical context file (other *.md allowed)
├── hooks/*.json             # Claude-shaped { "hooks": { "<Event>": [...] } }
└── agents/<name>.md         # YAML frontmatter (name, description, tools?, model?) + body
```

Skills follow the [Agent Skills](https://agentskills.io) frontmatter rules: `description` is required and `name` (defaulting to the folder name) must be lowercase letters, numbers and hyphens, up to 64 characters.
