import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../config/resolve.js';
import { parseConfig } from '../config/schema.js';
import type { AhmConfigInput } from '../config/schema.js';
import { loadHarness } from '../core/loader.js';
import type { Harness } from '../core/types.js';
import { exportHarness } from '../export/run.js';
import type { ExportEntry } from '../export/run.js';
import { flattenImports } from './context.js';
import { TARGETS } from './index.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', '__fixtures__', 'valid');

let out: string;
let source: string;
let harness: Harness;
let warn: ReturnType<typeof vi.fn<(message: string) => void>>;

const run = (input: AhmConfigInput, force = false) => {
  const config = resolveConfig({ config: parseConfig({ outputDir: out, ...input }, 'test'), baseDir: out }, {}, out);
  return exportHarness(harness, config, TARGETS, { warn, force });
};

const read = (...segments: string[]) => readFile(path.join(out, ...segments), 'utf8');
const summary = (entries: ExportEntry[]) =>
  entries.map(entry => [entry.target, entry.kind ?? '-', entry.name ?? '-', path.relative(out, entry.dest ?? out), entry.action, entry.reason ?? '']);

/** Copies the valid fixture and adds hooks/imports that exercise per-target filtering. */
beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'ahm-targets-'));
  source = path.join(out, 'harness');
  await mkdir(source);
  for (const entry of await readdir(fixture, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const from = path.join(entry.parentPath, entry.name);
      const to = path.join(source, path.relative(fixture, from));
      await mkdir(path.dirname(to), { recursive: true });
      await writeFile(to, await readFile(from));
    }
  }
  await writeFile(path.join(source, 'context', 'AGENTS.md'), '# Project instructions\n\n@style.md\n\nUse pnpm.\n');
  await writeFile(path.join(source, 'context', 'style.md'), 'Prefer small functions.\n');
  await writeFile(
    path.join(source, 'hooks', 'guard.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }, { type: 'prompt', prompt: 'ok?' }] }],
        Notification: [{ hooks: [{ type: 'command', command: 'notify' }] }],
      },
    }),
  );
  ({ harness } = await loadHarness(source));
  warn = vi.fn<(message: string) => void>();
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('given @imports in a context file', () => {
  it('should inline them recursively', async () => {
    expect(await flattenImports(path.join(source, 'context', 'AGENTS.md'))).toBe(
      '# Project instructions\n\nPrefer small functions.\n\nUse pnpm.\n',
    );
  });

  it('should reject circular imports', async () => {
    await writeFile(path.join(source, 'context', 'style.md'), '@AGENTS.md\n');
    await expect(flattenImports(path.join(source, 'context', 'AGENTS.md'))).rejects.toThrow('circular @import');
  });
});

describe('given the codex target', () => {
  it('should export skills, flattened context, filtered hooks and TOML agents', async () => {
    const entries = await run({ targets: ['codex'] });
    expect((await lstat(path.join(out, '.agents', 'skills', 'code-review'))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(out, 'AGENTS.md'))).isSymbolicLink()).toBe(false);
    expect(await read('AGENTS.md')).toContain('Prefer small functions.');
    expect(JSON.parse(await read('.codex', 'hooks.json'))).toEqual({
      hooks: {
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'pnpm lint:fix' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }] }],
      },
    });
    expect(await read('.codex', 'agents', 'reviewer.toml')).toBe(
      'name = "reviewer"\ndescription = "Reviews pull requests."\nmodel = "sonnet"\ndeveloper_instructions = "You review pull requests.\\n"\n',
    );
    expect(summary(entries).filter(([, , , , action]) => action === 'skipped')).toEqual([
      ['codex', 'hook', 'guard', path.join('.codex', 'hooks.json'), 'skipped', 'PreToolUse: handler type prompt not supported by codex'],
      ['codex', 'hook', 'guard', path.join('.codex', 'hooks.json'), 'skipped', 'event Notification not supported by codex'],
    ]);
  });

  it('should warn when AGENTS.md exceeds 32 KiB', async () => {
    await writeFile(path.join(source, 'context', 'style.md'), 'x'.repeat(33 * 1024));
    await run({ targets: ['codex'] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds the 32768-byte context budget'));
  });
});

describe('given the antigravity target', () => {
  it('should copy skills and transform hooks to the antigravity shape', async () => {
    await run({ targets: ['antigravity'] });
    expect((await lstat(path.join(out, '.agents', 'skills', 'code-review'))).isDirectory()).toBe(true);
    expect(await read('.agents', 'skills', 'code-review', 'references', 'checklist.md')).toContain('error handling');
    expect(JSON.parse(await read('.agents', 'hooks.json'))).toEqual({
      format: { PostToolUse: [{ matcher: 'Edit|Write', type: 'command', command: 'pnpm lint:fix' }] },
      guard: {
        PreToolUse: [
          { matcher: 'Bash', type: 'command', command: './guard.sh' },
          { matcher: 'Bash', type: 'prompt', prompt: 'ok?' },
        ],
      },
    });
    expect(await read('.agents', 'agents', 'reviewer.md')).toContain('name: reviewer');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Antigravity tool ids differ'));
    await expect(lstat(path.join(out, '.agents', 'workflows'))).rejects.toThrow();
  });

  it('should keep unrelated hook names in an existing hooks.json', async () => {
    await mkdir(path.join(out, '.agents'));
    await writeFile(path.join(out, '.agents', 'hooks.json'), JSON.stringify({ mine: { Stop: [] } }));
    await run({ targets: ['antigravity'] });
    expect(Object.keys(JSON.parse(await read('.agents', 'hooks.json')))).toEqual(['mine', 'format', 'guard']);
  });
});

describe('given codex and antigravity together', () => {
  it('should write shared destinations once, as real files', async () => {
    const entries = await run({ targets: ['codex', 'antigravity'] });
    expect((await lstat(path.join(out, '.agents', 'skills', 'code-review'))).isSymbolicLink()).toBe(false);
    expect(summary(entries).filter(([target, , , , action]) => target === 'codex' && action === 'shared')).toEqual([
      ['codex', 'skill', 'code-review', path.join('.agents', 'skills', 'code-review'), 'shared', 'written by antigravity'],
      ['codex', 'skill', 'release-notes', path.join('.agents', 'skills', 'release-notes'), 'shared', 'written by antigravity'],
      ['codex', 'context', 'AGENTS.md', 'AGENTS.md', 'shared', 'written by antigravity'],
      ['codex', 'context', 'style.md', 'style.md', 'shared', 'written by antigravity'],
    ]);
  });

  it('should keep the CLAUDE.md shim when claude-code shares AGENTS.md', async () => {
    await run({ targets: ['claude-code', 'codex'] });
    expect((await lstat(path.join(out, 'AGENTS.md'))).isSymbolicLink()).toBe(false);
    expect(await read('CLAUDE.md')).toBe('@AGENTS.md\n');
  });
});

describe('given the strands target', () => {
  it('should copy skills to .agent/skills and generate the python stub', async () => {
    const entries = await run({ targets: ['strands'] });
    expect(await read('.agent', 'skills', 'code-review', 'SKILL.md')).toContain('name: code-review');
    const stub = await read('ahm.strands.py');
    expect(stub).toContain('class AhmHooks(HookProvider):');
    expect(stub).toContain('registry.add_callback(BeforeToolCallEvent, self.before_tool_call)');
    expect(stub).toContain('{"matcher": "Bash", "command": "./guard.sh"}');
    expect(stub).toContain('{"matcher": "Edit|Write", "command": "pnpm lint:fix"}');
    expect(stub).toContain('reviewer = Agent(\n    name="reviewer",\n    description="Reviews pull requests.",\n    system_prompt="You review pull requests.\\n",\n).as_tool()');
    expect(stub).toContain('AGENT_TOOLS = [reviewer]');
    expect(summary(entries).filter(([, , , , action]) => action === 'skipped').map(row => row[5])).toEqual([
      'PreToolUse: handler type prompt not supported by strands',
      'event Notification not supported by strands',
    ]);
  });

  it('should only overwrite an edited stub with force', async () => {
    await run({ targets: ['strands'] });
    await writeFile(path.join(out, 'ahm.strands.py'), '# edited\n');
    const entries = await run({ targets: ['strands'] });
    expect(entries.find(entry => entry.dest?.endsWith('ahm.strands.py') && !entry.kind)).toMatchObject({ action: 'skipped', reason: 'exists' });
    await run({ targets: ['strands'] }, true);
    expect(await read('ahm.strands.py')).toContain('class AhmHooks');
  });
});

describe('given every target at once', () => {
  it('should export without errors and be idempotent', async () => {
    const all: AhmConfigInput = { targets: ['claude-code', 'codex', 'antigravity', 'strands'] };
    await run(all);
    const second = await run(all);
    expect(second.filter(entry => !['skipped', 'shared'].includes(entry.action))).toEqual([]);
    expect(second.filter(entry => entry.action === 'skipped' && !['unchanged'].includes(entry.reason ?? '') && !entry.reason?.includes('not supported'))).toEqual([]);
  });
});
