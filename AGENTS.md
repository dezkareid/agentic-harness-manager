# Agent Instructions: agentic-harness-manager

`agentic-harness-manager` (`ahm`) is a CLI that reads a single harness source (skills, context files, hooks, subagents) and exports it into the on-disk layout each agent expects: Claude Code, Codex, Antigravity and Strands. It supports pluggable export strategies (symlink, copy, tagged override) so one source can serve many agents.

Published to npm as `@dezkareid/agentic-harness-manager`; the binary is `ahm`.

## Tech Stack & Versions

- **Node.js**: 24 (CI); ESM only (`"type": "module"`)
- **Package Manager**: `pnpm` `10.30.1` (pinned via `packageManager`). Always use pnpm.
- **TypeScript**: `5.9.3`, strict, `module`/`moduleResolution` `NodeNext`
- **Rollup**: `4.64.7` (`@rollup/plugin-typescript`, `node-resolve`, `commonjs`, `json`)
- **Vitest**: `5.0.5`
- **ESLint**: `10.13.0` with `@dezkareid/eslint-plugin-web/typescript`
- **Commander**: `14.0.2`
- **@types/node**: `24.19.2`

Always use exact versions for dependencies. Do not use `^` or `~`.

## Project Structure

```text
src/
├── index.ts          # Binary entry point (rollup input → dist/index.js)
├── program.ts        # Commander program, commands and exit codes (run())
├── cli/              # Flag validation (options.ts) and table/JSON output (format.ts)
├── config/           # Zod schema, config discovery (load.ts) and CLI/config merge (resolve.ts)
├── targets/          # Target interface, the four targets, hook merging, context flattening
├── export/           # exportHarness engine: settings → layout → strategy/transform → report
├── strategies/       # symlink, copy and override strategies plus the tag renderer
├── core/             # Harness model (types.ts), frontmatter parsing and the pure loader
└── utils/
    └── logger.ts     # The only place allowed to write to stdout/stderr
.github/
├── actions/          # setup-js and semantic-release composite actions
├── releaserc-template.json
└── workflows/ci.yml  # test → release
```

- Loader fixtures live in `src/core/__fixtures__/` (`valid/`, `invalid/`).
- End-to-end tests live in `test/e2e/` and drive the CLI (`run()`) against `test/fixtures/basic-harness/`. They assert each target's tree with vitest snapshots (`test/e2e/__snapshots__/`).
- Tests live next to the code they cover with the `.spec.ts` suffix.
- `dist/` is the build output and is gitignored.

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

## Harness Source Layout

`ahm` reads a harness folder (default `./harness`) into an in-memory `Harness` (`src/core/types.ts`). The loader (`loadHarness`) never writes to disk, so `ahm list` and `--dry-run` reuse it.

```text
harness/
├── skills/<name>/SKILL.md   # + optional references/, scripts/, assets/; exported as a directory
├── context/*.md             # AGENTS.md is the canonical context file
├── hooks/*.json             # Claude-shaped: { "hooks": { "<Event>": [ ... ] } }
└── agents/<name>.md         # YAML frontmatter + Markdown body
```

- **Skill frontmatter** (Agent Skills standard): `description` required (≤ 1024 chars); `name` optional, defaults to the folder name, must be lowercase letters/numbers/single hyphens, 1–64 chars, and must match the folder. Unknown keys are preserved.
- **Agent frontmatter**: `name` and `description` required; `tools` (string or list) and `model` optional. Unknown keys are preserved.
- Invalid files fail the load with one `HarnessLoadError` listing every offending path. Empty folders and ignored files produce warnings.

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

Targets run in the order antigravity → strands → codex → claude-code, so destinations shared between targets (`.agents/skills/*`, `AGENTS.md`) are written once as real files. Later targets report `shared`. `@path` lines in context files are inlined for every target except claude-code, which supports imports natively. Context files that are only pulled in through an import are therefore skipped (`inlined into the importing context file`) by codex, antigravity and strands, and still exported for claude-code.

Copies keep file permissions, so executable skill scripts stay executable.

## Development

Always use Context7 MCP when you need library/API documentation, code generation, setup or configuration steps.

```bash
pnpm install          # install dependencies (also installs husky hooks)
pnpm build            # rollup -c → dist/index.js
node dist/index.js --help
pnpm lint             # eslint .
pnpm lint:fix
pnpm test             # vitest run
```

### Commit Rules

- Use Conventional Commits; `commitlint` enforces it in the `commit-msg` hook.
- The `pre-commit` hook runs `pnpm lint && pnpm test`.
- Never commit directly to `main`. Work on a branch and open a PR.

## Testing

Tests use **Vitest** with **BDD** conventions:

- `describe` blocks express the context ("given …"), `it` blocks the expected behaviour ("should …").
- Side effects (filesystem, `process.exit`, streams) are isolated with temp directories, `vi.mock` / `vi.spyOn` or injected streams so tests stay fast and deterministic.
- Pure functions are tested without mocks.

```bash
pnpm test                    # unit + e2e (CI does not write new snapshots)
pnpm exec vitest run -u      # update snapshots after an intended layout change; review the diff
```

- End-to-end tests export the fixture into a fresh `tmpdir` per test and never mutate the fixture.
- When a target layout changes on purpose, update the snapshots and check that each listed path and type (`dir`, `file`, `symlink`) is what the agent expects.
- CI runs on ubuntu (symlinks available); an optional `windows-latest` job runs with `continue-on-error`.

## Coding Standards & Style

- Strict TypeScript, ESM imports with explicit `.js` extensions (NodeNext).
- Prefer small pure functions; keep filesystem access at the edges so logic is testable.
- Follow the ESLint config; run `pnpm lint:fix` before committing.

### Argument Parsing

CLI arguments are parsed with **Commander.js** (`commander`). The program is built in `src/program.ts`: `createProgram()` defines the commands, and `run(argv, deps)` parses them and returns the exit code (commander runs with `exitOverride()`, so it never calls `process.exit`). Raw flags are validated and converted in `src/cli/options.ts` (`toCliOptions`) before `resolveConfig` merges them over the config file. `src/index.ts` only wires `SIGINT` → 130 and sets `process.exitCode`. Tests call `run()` with an injected `cwd` and logger; `src/smoke.spec.ts` builds and runs `dist/index.js`.

### I/O & Logging

Never use `console.log` (or `console.*`) directly. All output goes through the logger in `src/utils/logger.ts`:

- `info` writes progress to stdout and is hidden by `--quiet`.
- `warn`, `error` and `debug` write to stderr; `debug` only shows with `--verbose`.
- `print` and `printError` write command output verbatim (tables, JSON, commander help and usage errors) and ignore the level.
- Colors are on only for a TTY without `NO_COLOR`.
- `createLogger(stdout, stderr, { level, color })` accepts custom streams for tests.

Errors surface as exit codes returned by `run()` instead of calling `process.exit`.

### Distribution / Compilation

- **Build**: rollup bundles `src/index.ts` into a single ESM file `dist/index.js` with the `#!/usr/bin/env node` banner. All dependencies and Node builtins are external.
- **Publish**: semantic-release runs in GitHub Actions on pushes to `main`, `next`, `beta` and `alpha`. `@anolilab/semantic-release-pnpm` bumps the version and publishes to npm with **OIDC trusted publishing and provenance**; `@semantic-release/exec` rebuilds after the version bump so `ahm --version` matches the release. Tags use `agentic-harness-manager-v${version}`.
- Published `files`: `dist`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `skills`.

## CI configuration

The pipeline is designed to need **zero stored secrets and zero repository variables**.

- **npm publish**: OIDC trusted publishing (Trusted Publisher configured on npmjs.com for `dezkareid/agentic-harness-manager`, workflow `ci.yml`). No `NPM_TOKEN`. Requires `id-token: write` on the release job.
- **GitHub Release, CHANGELOG commit/tag push, issue/PR comments**: the automatic `secrets.GITHUB_TOKEN`, scoped by the release job `permissions` (`contents: write`, `issues: write`, `pull-requests: write`, `id-token: write`).
- **Plain `env:` entries** (not GitHub variables): `HUSKY: 0` at workflow level, `NPM_CONFIG_PROVENANCE: true` on the release job.
- **Not needed now**: a PAT. Only if `main` later gets a ruleset the automatic token cannot bypass, or release commits must trigger other workflows, add a PAT as a repo secret (`gh secret set RELEASE_TOKEN`) and pass it as `github-token` to the semantic-release action.
- **Verify**: `gh secret list` and `gh variable list` should both be empty.

## Debugging

- Run the built CLI directly: `node dist/index.js <command> --help`.
- Rebuild after source changes; `dist/` is not updated automatically.
- Commander errors (unknown option/command) are printed to stderr and exit non-zero.
- If husky hooks do not run, re-run `pnpm install` (the `prepare` script installs them). CI sets `HUSKY=0`.

## Documentation

When a CLI command or option is added, updated, removed or renamed, update `AGENTS.md`, `CLAUDE.md` and `README.md`.
