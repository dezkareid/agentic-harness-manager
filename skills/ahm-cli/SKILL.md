---
name: ahm-cli
description: "Operate the ahm CLI (@dezkareid/agentic-harness-manager) to export an agentic harness (skills, AGENTS.md context, hooks, subagents) to Claude Code, Codex, Antigravity and Strands. Use when the user wants to export harness, sync skills to codex/antigravity/strands, set up ahm.config.json, preview with ahm list, or debug skipped/omitted items in an ahm export."
metadata:
  version: "1.0.0"
---

# ahm CLI

`ahm` reads one harness folder and writes the layout each agent expects. One source of truth, many agents.

## When to use

- The user says "export harness", "sync skills to codex/antigravity", "ahm", "agentic harness", or wants the same skills, `AGENTS.md`, hooks or subagents available in several coding agents.
- Setting up or editing `ahm.config.json` / `ahm.config.yaml` / the `"ahm"` key in `package.json`.
- An `ahm export` reported `skipped`, `shared`, `failed` or exited non-zero and needs explaining.

## When not to use

- Authoring the content of a skill itself: write the `SKILL.md` first, then export it with `ahm`.
- Configuring MCP servers, marketplaces or remote harnesses. `ahm` v1 does not export those.
- Editing generated output (`.claude/skills/*`, `.agents/skills/*`, `ahm_strands.py`). Edit the harness source and re-export instead.

## Harness layout

```text
harness/
├── skills/<name>/SKILL.md   # + references/, scripts/, assets/
├── context/AGENTS.md        # canonical context; a line "@other.md" imports another file
├── hooks/*.json             # Claude-shaped { "hooks": { "<Event>": [...] } }
└── agents/<name>.md         # frontmatter: name, description, tools?, model?
```

Skill `name` must equal its folder: lowercase letters, numbers and single hyphens, up to 64 chars. `description` is required.

## Recipes

```bash
ahm init                                   # commented ahm.config.json (add --force to overwrite)
ahm list                                   # plan only: item × target × strategy × destination
ahm export                                 # targets from the config
ahm export --target claude-code,codex      # override targets for one run
ahm export --target strands --out ./agent  # different output directory
ahm export --omit 'hook:*' --omit 'skill:internal-*'
ahm export --strategy override --tag team  # render tag blocks with an extra tag
ahm export --dry-run --format json         # machine-readable plan; writes nothing
ahm export --force                         # replace destinations that differ
ahm -v export                              # show which config and source were used
```

Always run `ahm list` (or `--dry-run`) before the first real export in a repository, and show the user the plan.

Exit codes: `0` ok · `1` bad flag, config or harness · `2` some items `failed` (the rest were exported) · `130` interrupted.

## Config keys

| Key | Default | Notes |
|---|---|---|
| `source` | `./harness` | harness folder |
| `outputDir` | `.` | where target trees go |
| `targets` | `[]` | ids or `{ id, outputDir?, strategy?, tags?, omit? }` |
| `defaultStrategy` | per target | `symlink`, `copy` or `override` |
| `omit` | `[]` | selectors: `kind:glob` or a name glob |
| `overrides` | `{}` | `{ "<selector>": { strategy?, tags?, outputDir? } }` |

Precedence for `strategy`/`outputDir`: CLI > per-target > per-item override > global > target default. `tags` and `omit` accumulate. Full reference: [references/config-schema.md](references/config-schema.md).

## Choosing a strategy

| Situation | Strategy |
|---|---|
| Claude Code or Codex, content identical for every agent | `symlink` (default): edits to the harness show up immediately |
| Antigravity, Strands, Windows, or a repo that must contain real files | `copy` (default for antigravity/strands) |
| The file needs agent-specific wording | `override` on that item, using tag blocks |

Tag blocks (markers on their own line):

```markdown
<!-- ahm:tag:codex,antigravity -->
Use rg to search.
<!-- /ahm:tag -->
<!-- ahm:omit -->
Maintainer-only note.
<!-- /ahm:omit -->
<!-- ahm:only:claude-code --> Use the Grep tool.
```

Each target id is always an active tag. Prefer applying `override` per item (`"overrides": { "skill:code-review": { "strategy": "override" } }`) over setting it globally, so everything else stays symlinked.

Where each kind lands per target: [references/target-matrix.md](references/target-matrix.md).

## Troubleshooting

- **`skipped (exists)`**: the destination differs (local edits). Inspect it, then `ahm export --force`.
- **`skipped (unchanged)`**: already up to date. Nothing to do.
- **`skipped (omitted)`**: an `omit` selector matched (config, target entry or `--omit`). `ahm list` shows which.
- **`skipped (… not supported by <target>)`**: that agent has no equivalent hook event or handler type. Expected.
- **`skipped (inlined into the importing context file)`**: a context file only used via `@import`; its text is already in `AGENTS.md`.
- **`shared (written by <target>)`**: another selected target wrote the same path (e.g. `.agents/skills` for codex + antigravity).
- **`warn: cannot create symlink (EPERM), copying instead`**: symlinks are unavailable (Windows without Developer Mode, some network drives). Use `--no-symlink` or `"defaultStrategy": "copy"`.
- **`failed` with `nested ahm block` / `never closed`**: fix the tag blocks at the reported line.
- **`Invalid harness:` / `Invalid config in …`**: the message lists each file or key path to fix.
- **Windows**: prefer `copy`; Codex never follows file symlinks on any OS, so `ahm` always writes its `AGENTS.md` as a real file.
