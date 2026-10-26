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
