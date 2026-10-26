import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../config/resolve.js';
import type { CliOptions } from '../config/resolve.js';
import { parseConfig } from '../config/schema.js';
import type { AhmConfigInput } from '../config/schema.js';
import { loadHarness } from '../core/loader.js';
import type { Harness } from '../core/types.js';
import { exportHarness } from '../export/run.js';
import type { ExportOptions } from '../export/run.js';
import { CLAUDE_SHIM } from './claude-code.js';
import { TARGETS } from './index.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', '__fixtures__', 'valid');

let out: string;
let harness: Harness;

const run = (input: AhmConfigInput = {}, cli: CliOptions = {}, options: Partial<ExportOptions> = {}) => {
  const config = resolveConfig({ config: parseConfig({ targets: ['claude-code'], outputDir: out, ...input }, 'test'), baseDir: out }, cli, out);
  return exportHarness(harness, config, TARGETS, { warn: vi.fn(), ...options });
};

const tree = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)))
    // Symlinked skill directories are not descended into by readdir.
    .sort();
};

const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));

beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'ahm-claude-'));
  ({ harness } = await loadHarness(fixture));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('given the fixture harness and the default symlink strategy', () => {
  it('should produce the .claude tree file by file', async () => {
    const entries = await run();
    expect(await tree(out)).toEqual([
      '.claude',
      path.join('.claude', 'agents'),
      path.join('.claude', 'agents', 'reviewer.md'),
      path.join('.claude', 'settings.json'),
      path.join('.claude', 'skills'),
      path.join('.claude', 'skills', 'code-review'),
      path.join('.claude', 'skills', 'release-notes'),
      'AGENTS.md',
      'CLAUDE.md',
    ]);
    expect(entries.map(entry => [entry.kind ?? '-', path.relative(out, entry.dest ?? ''), entry.action])).toEqual([
      ['skill', path.join('.claude', 'skills', 'code-review'), 'linked'],
      ['skill', path.join('.claude', 'skills', 'release-notes'), 'linked'],
      ['context', 'AGENTS.md', 'linked'],
      ['agent', path.join('.claude', 'agents', 'reviewer.md'), 'linked'],
      ['context', 'CLAUDE.md', 'rendered'],
      ['-', path.join('.claude', 'settings.json'), 'merged'],
    ]);
  });

  it('should link skills as directories pointing at the source', async () => {
    await run();
    const skill = path.join(out, '.claude', 'skills', 'code-review');
    expect((await lstat(skill)).isSymbolicLink()).toBe(true);
    expect(await realpath(skill)).toBe(await realpath(path.join(fixture, 'skills', 'code-review')));
    expect(path.isAbsolute(await readlink(skill))).toBe(false);
    expect(await readFile(path.join(skill, 'references', 'checklist.md'), 'utf8')).toContain('error handling');
  });

  it('should write a CLAUDE.md that imports AGENTS.md', async () => {
    await run();
    expect(await readFile(path.join(out, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_SHIM);
    expect(await readFile(path.join(out, 'AGENTS.md'), 'utf8')).toContain('Use pnpm.');
  });

  it('should merge hooks into settings.json', async () => {
    await run();
    expect(await json(path.join(out, '.claude', 'settings.json'))).toEqual({
      hooks: {
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'pnpm lint:fix' }] }],
      },
    });
  });

  it('should never write legacy commands', async () => {
    await run();
    await expect(lstat(path.join(out, '.claude', 'commands'))).rejects.toThrow();
  });

  it('should be idempotent', async () => {
    await run();
    const entries = await run();
    expect(entries.every(entry => entry.action === 'skipped' && entry.reason === 'unchanged')).toBe(true);
  });

  it('should not touch the filesystem on a dry run', async () => {
    const entries = await run({}, {}, { dryRun: true });
    expect(entries).toHaveLength(6);
    expect(await readdir(out)).toEqual([]);
  });
});

describe('given a pre-existing settings.json', () => {
  beforeEach(async () => {
    await mkdir(path.join(out, '.claude'));
    await writeFile(
      path.join(out, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(pnpm test)'] },
        hooks: {
          PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'pnpm lint:fix' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
        },
      }),
    );
  });

  it('should keep unrelated keys and events and dedupe identical entries', async () => {
    const entries = await run();
    expect(await json(path.join(out, '.claude', 'settings.json'))).toEqual({
      permissions: { allow: ['Bash(pnpm test)'] },
      hooks: {
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'pnpm lint:fix' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      },
    });
    expect(entries.at(-1)).toMatchObject({ action: 'skipped', reason: 'unchanged' });
  });

  it('should append new hook entries to existing events', async () => {
    await writeFile(
      path.join(out, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [] }] } }),
    );
    await run();
    expect(await json(path.join(out, '.claude', 'settings.json'))).toEqual({
      hooks: {
        PostToolUse: [
          { matcher: 'Bash', hooks: [] },
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'pnpm lint:fix' }] },
        ],
      },
    });
  });
});

describe('given the override strategy for AGENTS.md', () => {
  it('should render CLAUDE.md instead of the shim and AGENTS.md', async () => {
    const entries = await run({ overrides: { 'context:AGENTS.md': { strategy: 'override' } } });
    expect(await readFile(path.join(out, 'CLAUDE.md'), 'utf8')).toContain('Use pnpm.');
    await expect(lstat(path.join(out, 'AGENTS.md'))).rejects.toThrow();
    expect(entries.find(entry => entry.kind === 'context')).toMatchObject({ action: 'rendered' });
  });
});

describe('given omissions and a custom output directory', () => {
  it('should skip omitted items and write under outputDir only', async () => {
    const entries = await run({ omit: ['hook:*', 'agent:*'] }, { outputDir: path.join(out, 'nested') });
    expect(entries.filter(entry => entry.reason === 'omitted').map(entry => entry.kind)).toEqual(['hook', 'agent']);
    expect(await readdir(out)).toEqual(['nested']);
  });

  it('should fail items whose layout escapes outputDir and keep exporting', async () => {
    harness.items.push({ ...harness.items.find(item => item.kind === 'agent')!, name: '../../../escape' });
    const entries = await run({ omit: ['hook:*'] });
    expect(entries.find(entry => entry.name === '../../../escape')).toMatchObject({
      action: 'failed',
      reason: expect.stringContaining('refusing to write outside'),
    });
  });
});
