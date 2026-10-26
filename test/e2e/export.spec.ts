import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExportEntry } from '../../src/export/run.js';
import { EXIT, run } from '../../src/program.js';
import { createLogger } from '../../src/utils/logger.js';

const harness = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'basic-harness');

let cwd: string;
let stdout: string[];
let stderr: string[];

const sink = (into: string[]) => ({ write: (chunk: string) => into.push(chunk) }) as unknown as NodeJS.WritableStream;

/** Runs the CLI in the temp project with JSON output and returns the parsed entries. */
const ahm = async (...argv: string[]): Promise<{ code: number; entries: ExportEntry[] }> => {
  stdout = [];
  const code = await run([...argv, '--format', 'json', '--quiet'], {
    cwd,
    logger: createLogger(sink(stdout), sink(stderr), { color: false }),
  });
  const text = stdout.join('');
  return { code, entries: text ? (JSON.parse(text) as ExportEntry[]) : [] };
};

/** Every path under `dir` (symlinks not followed) as `relative/path [dir|file|symlink]`. */
const describeTree = async (dir: string): Promise<string[]> => {
  const lines: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const name of (await readdir(current)).sort()) {
      const full = path.join(current, name);
      const stats = await lstat(full);
      const type = stats.isSymbolicLink() ? 'symlink' : stats.isDirectory() ? 'dir' : 'file';
      lines.push(`${path.relative(dir, full).split(path.sep).join('/')} [${type}]`);
      if (type === 'dir') {
        await walk(full);
      }
    }
  };
  await walk(dir);
  return lines.filter(line => !line.startsWith('ahm.config.json'));
};

const read = (...segments: string[]) => readFile(path.join(cwd, ...segments), 'utf8');

const summary = (entries: ExportEntry[]) =>
  entries.map(entry => `${entry.target} ${entry.kind ?? '-'}:${entry.name ?? '-'} ${entry.action}${entry.reason ? ` (${entry.reason})` : ''}`);

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'ahm-e2e-'));
  stderr = [];
  await writeFile(path.join(cwd, 'ahm.config.json'), JSON.stringify({ source: harness }));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('given the basic harness exported to each target', () => {
  it.each(['claude-code', 'codex', 'antigravity', 'strands'])('should produce the expected %s tree', async (target) => {
    const { code, entries } = await ahm('export', '--target', target);
    expect(code).toBe(EXIT.ok);
    expect(await describeTree(cwd)).toMatchSnapshot('tree');
    expect(summary(entries)).toMatchSnapshot('report');
  });

  it('should never write to the fixture', async () => {
    const before = await describeTree(harness);
    await ahm('export', '--target', 'claude-code,codex,antigravity,strands', '--strategy', 'override', '--force');
    expect(await describeTree(harness)).toEqual(before);
  });
});

describe('given each strategy', () => {
  it('should link skills with symlink', async () => {
    await ahm('export', '--target', 'claude-code', '--strategy', 'symlink');
    expect((await lstat(path.join(cwd, '.claude', 'skills', 'code-review'))).isSymbolicLink()).toBe(true);
  });

  it('should copy skills verbatim with copy', async () => {
    await ahm('export', '--target', 'claude-code', '--strategy', 'copy');
    expect((await lstat(path.join(cwd, '.claude', 'skills', 'code-review'))).isDirectory()).toBe(true);
    expect(await read('.claude', 'skills', 'code-review', 'SKILL.md')).toContain('<!-- ahm:tag:claude-code -->');
  });

  it('should fall back to copies with --no-symlink', async () => {
    const { entries } = await ahm('export', '--target', 'claude-code', '--no-symlink');
    expect((await lstat(path.join(cwd, '.claude', 'skills', 'code-review'))).isDirectory()).toBe(true);
    expect(entries.find(entry => entry.name === 'code-review')).toMatchObject({ action: 'copied', reason: 'symlinks disabled' });
  });
});

describe('given the override renderer', () => {
  it.each([
    ['claude-code', '.claude/skills/code-review/SKILL.md', ['Grep'], ['rg', 'JSON list']],
    ['codex', '.agents/skills/code-review/SKILL.md', ['rg'], ['Grep', 'JSON list']],
    ['strands', '.agent/skills/code-review/SKILL.md', ['JSON list'], ['Grep', 'rg']],
  ])('should render tag blocks for %s', async (target, file, kept, removed) => {
    await ahm('export', '--target', target, '--strategy', 'override');
    const rendered = await read(...file.split('/'));
    kept.forEach(text => expect(rendered).toContain(text));
    removed.forEach(text => expect(rendered).not.toContain(text));
    expect(rendered).not.toContain('Maintainer note');
    expect(rendered).not.toContain('ahm:');
  });

  it('should render CLAUDE.md for claude-code and flatten AGENTS.md elsewhere', async () => {
    await ahm('export', '--target', 'claude-code', '--strategy', 'override');
    expect(await read('CLAUDE.md')).toContain('Prefer the Edit tool');
    await ahm('export', '--target', 'codex', '--strategy', 'override');
    const agents = await read('AGENTS.md');
    expect(agents).toContain('## Conventions');
    expect(agents).not.toContain('Prefer the Edit tool');
  });

  it('should fail the item and exit 2 on nested blocks', async () => {
    const broken = path.join(cwd, 'broken');
    await mkdir(path.join(broken, 'context'), { recursive: true });
    await writeFile(path.join(broken, 'context', 'AGENTS.md'), '<!-- ahm:tag:a -->\n<!-- ahm:omit -->\n<!-- /ahm:omit -->\n<!-- /ahm:tag -->\n');
    await writeFile(path.join(cwd, 'ahm.config.json'), JSON.stringify({ source: broken }));
    const { code, entries } = await ahm('export', '--target', 'codex', '--strategy', 'override');
    expect(code).toBe(EXIT.exportFailed);
    expect(entries[0]).toMatchObject({ action: 'failed', reason: expect.stringContaining('nested ahm block') });
  });
});

describe('given omit selectors', () => {
  it('should skip items by kind:name glob', async () => {
    const { entries } = await ahm('export', '--target', 'claude-code', '--omit', 'skill:code-*', '--omit', 'hook:*');
    expect(entries.filter(entry => entry.reason === 'omitted').map(entry => `${entry.kind}:${entry.name}`)).toEqual([
      'skill:code-review',
      'hook:quality',
    ]);
    await expect(lstat(path.join(cwd, '.claude', 'settings.json'))).rejects.toThrow();
  });

  it('should skip items by bare name glob across kinds', async () => {
    const { entries } = await ahm('export', '--target', 'codex', '--omit', '*-writer');
    expect(entries.filter(entry => entry.reason === 'omitted').map(entry => entry.name)).toEqual(['docs-writer']);
  });
});

describe('given repeated exports', () => {
  it('should report no changes on the second run', async () => {
    const all = ['export', '--target', 'claude-code,codex,antigravity,strands'];
    await ahm(...all);
    const { entries } = await ahm(...all);
    expect(entries.filter(entry => !['skipped', 'shared'].includes(entry.action))).toEqual([]);
    expect(entries.filter(entry => entry.action === 'skipped' && entry.reason === 'exists')).toEqual([]);
  });

  it('should replace differing files only with --force', async () => {
    await ahm('export', '--target', 'codex');
    await writeFile(path.join(cwd, 'AGENTS.md'), 'local edit\n');
    const { entries } = await ahm('export', '--target', 'codex');
    expect(entries.find(entry => entry.name === 'AGENTS.md')).toMatchObject({ action: 'skipped', reason: 'exists' });
    expect(await read('AGENTS.md')).toBe('local edit\n');
    await ahm('export', '--target', 'codex', '--force');
    expect(await read('AGENTS.md')).toContain('## Conventions');
  });
});

describe('given --dry-run and list', () => {
  it('should write nothing and report the same plan as a real export', async () => {
    const all = ['--target', 'claude-code,codex,antigravity,strands'];
    const dry = await ahm('export', ...all, '--dry-run');
    const plan = await ahm('list', ...all);
    expect(await describeTree(cwd)).toEqual([]);
    expect(plan.entries).toEqual(dry.entries);
    const real = await ahm('export', ...all);
    expect(summary(real.entries)).toEqual(summary(dry.entries));
  });
});

describe('given a pre-existing Claude Code settings.json', () => {
  it('should merge hooks while keeping unrelated settings', async () => {
    await mkdir(path.join(cwd, '.claude'));
    await writeFile(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }),
    );
    await ahm('export', '--target', 'claude-code');
    const settings = JSON.parse(await read('.claude', 'settings.json')) as { model: string; hooks: Record<string, unknown[]> };
    expect(settings.model).toBe('opus');
    expect(Object.keys(settings.hooks).sort()).toEqual(['Notification', 'PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
  });
});

// Windows has no executable bit to preserve.
describe.skipIf(process.platform === 'win32')('given skill scripts', () => {
  it.each(['copy', 'override'])('should keep the executable bit with %s', async (strategy) => {
    await ahm('export', '--target', 'claude-code', '--strategy', strategy);
    const mode = (await lstat(path.join(cwd, '.claude', 'skills', 'release-notes', 'scripts', 'collect.sh'))).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});
