# Config schema

Copied from the README `## Configuration` section. The authoritative definition is the Zod schema in `src/config/schema.ts`.

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
