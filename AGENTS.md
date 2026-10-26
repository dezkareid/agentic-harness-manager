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
├── program.ts        # Commander program definition
├── config/           # Zod schema, config discovery (load.ts) and CLI/config merge (resolve.ts)
├── core/             # Harness model (types.ts), frontmatter parsing and the pure loader
└── utils/
    └── logger.ts     # The only place allowed to write to stdout/stderr
.github/
├── actions/          # setup-js and semantic-release composite actions
├── releaserc-template.json
└── workflows/ci.yml  # test → release
```

- Loader fixtures live in `src/core/__fixtures__/` (`valid/`, `invalid/`).
- Tests live next to the code they cover with the `.spec.ts` suffix.
- `dist/` is the build output and is gitignored.

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
pnpm test
```

## Coding Standards & Style

- Strict TypeScript, ESM imports with explicit `.js` extensions (NodeNext).
- Prefer small pure functions; keep filesystem access at the edges so logic is testable.
- Follow the ESLint config; run `pnpm lint:fix` before committing.

### Argument Parsing

CLI arguments are parsed with **Commander.js** (`commander`). The program is built in `src/program.ts` (`createProgram()`) so tests can construct and inspect it without running the binary; `src/index.ts` only calls `parseAsync(process.argv)`.

### I/O & Logging

Never use `console.log` (or `console.*`) directly. All output goes through the logger in `src/utils/logger.ts`: `info` writes to stdout, `warn`/`error` write to stderr. `createLogger(stdout, stderr)` accepts custom streams for tests. Errors surface as a non-zero `process.exitCode` instead of calling `process.exit`.

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
