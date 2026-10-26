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

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
```

Releases are automated with semantic-release from `main` (see [AGENTS.md](./AGENTS.md#ci-configuration)).

## Harness source layout

```text
harness/
├── skills/<name>/SKILL.md   # + optional references/, scripts/, assets/
├── context/AGENTS.md        # canonical context file (other *.md allowed)
├── hooks/*.json             # Claude-shaped { "hooks": { "<Event>": [...] } }
└── agents/<name>.md         # YAML frontmatter (name, description, tools?, model?) + body
```

Skills follow the [Agent Skills](https://agentskills.io) frontmatter rules: `description` is required and `name` (defaulting to the folder name) must be lowercase letters, numbers and hyphens, up to 64 characters.
