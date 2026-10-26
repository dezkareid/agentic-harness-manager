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
