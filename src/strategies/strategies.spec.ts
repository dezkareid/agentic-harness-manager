import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessItem } from '../core/types.js';
import { copyStrategy, getStrategy, overrideStrategy, symlinkStrategy, writeGenerated } from './index.js';
import type { StrategyContext } from './index.js';

let root: string;
let skill: HarnessItem;
let context: HarnessItem;
let ctx: StrategyContext;

const out = (...segments: string[]) => path.join(root, 'out', ...segments);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ahm-strategy-'));
  const skillDir = path.join(root, 'harness', 'skills', 'demo');
  await mkdir(path.join(skillDir, 'references'), { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: demo\ndescription: d\n---\n<!-- ahm:tag:codex -->\nCodex.\n<!-- /ahm:tag -->\nAll.\n',
  );
  await writeFile(path.join(skillDir, 'references', 'notes.md'), '<!-- ahm:omit -->\nx\n<!-- /ahm:omit -->\nnotes\n');
  await writeFile(path.join(skillDir, 'run.sh'), '<!-- ahm:omit -->\n');
  const contextFile = path.join(root, 'harness', 'context', 'AGENTS.md');
  await mkdir(path.dirname(contextFile), { recursive: true });
  await writeFile(contextFile, '# Agents\n');
  skill = { kind: 'skill', name: 'demo', sourcePath: skillDir, isDirectory: true };
  context = { kind: 'context', name: 'AGENTS.md', sourcePath: contextFile, isDirectory: false };
  ctx = { tags: ['codex'], warn: vi.fn() };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('given the strategy registry', () => {
  it('should return each strategy by name', () => {
    expect(getStrategy('symlink')).toBe(symlinkStrategy);
    expect(getStrategy('copy')).toBe(copyStrategy);
    expect(getStrategy('override')).toBe(overrideStrategy);
  });
});

describe('given the symlink strategy', () => {
  it('should link a skill directory with a relative symlink', async () => {
    expect(await symlinkStrategy.apply(skill, out('.claude', 'skills', 'demo'), ctx)).toEqual({ action: 'linked' });
    const dest = out('.claude', 'skills', 'demo');
    expect((await lstat(dest)).isSymbolicLink()).toBe(true);
    expect(path.isAbsolute(await readlink(dest))).toBe(false);
    expect(await readFile(path.join(dest, 'SKILL.md'), 'utf8')).toContain('Codex.');
  });

  it('should leave an existing link to the same source alone', async () => {
    await symlinkStrategy.apply(skill, out('demo'), ctx);
    expect(await symlinkStrategy.apply(skill, out('demo'), ctx)).toEqual({ action: 'skipped', reason: 'unchanged' });
  });

  it('should skip a differing destination unless forced', async () => {
    await mkdir(out(), { recursive: true });
    await writeFile(out('AGENTS.md'), 'mine');
    expect(await symlinkStrategy.apply(context, out('AGENTS.md'), ctx)).toEqual({ action: 'skipped', reason: 'exists' });
    expect(await symlinkStrategy.apply(context, out('AGENTS.md'), { ...ctx, force: true })).toEqual({ action: 'linked' });
    expect((await lstat(out('AGENTS.md'))).isSymbolicLink()).toBe(true);
  });

  it('should copy instead when symlinks are disabled', async () => {
    expect(await symlinkStrategy.apply(skill, out('demo'), { ...ctx, noSymlink: true })).toEqual({
      action: 'copied',
      reason: 'symlinks disabled',
    });
    expect((await lstat(out('demo'))).isDirectory()).toBe(true);
  });

  it('should not touch the filesystem on a dry run', async () => {
    expect(await symlinkStrategy.apply(skill, out('demo'), { ...ctx, dryRun: true })).toEqual({ action: 'linked' });
    await expect(lstat(out('demo'))).rejects.toThrow();
  });
});

describe('given the copy strategy', () => {
  it('should copy a skill directory recursively', async () => {
    expect(await copyStrategy.apply(skill, out('demo'), ctx)).toEqual({ action: 'copied' });
    expect(await readFile(out('demo', 'references', 'notes.md'), 'utf8')).toContain('ahm:omit');
    expect(await readFile(out('demo', 'run.sh'), 'utf8')).toBe('<!-- ahm:omit -->\n');
  });

  it('should be idempotent and only replace differing files with force', async () => {
    await copyStrategy.apply(context, out('AGENTS.md'), ctx);
    expect(await copyStrategy.apply(context, out('AGENTS.md'), ctx)).toEqual({ action: 'skipped', reason: 'unchanged' });
    await writeFile(out('AGENTS.md'), 'edited');
    expect(await copyStrategy.apply(context, out('AGENTS.md'), ctx)).toEqual({ action: 'skipped', reason: 'exists' });
    expect(await copyStrategy.apply(context, out('AGENTS.md'), { ...ctx, force: true })).toEqual({ action: 'copied' });
    expect(await readFile(out('AGENTS.md'), 'utf8')).toBe('# Agents\n');
  });

  it('should treat an extra file in a copied directory as a difference', async () => {
    await copyStrategy.apply(skill, out('demo'), ctx);
    await writeFile(out('demo', 'extra.md'), 'x');
    expect(await copyStrategy.apply(skill, out('demo'), ctx)).toEqual({ action: 'skipped', reason: 'exists' });
    await copyStrategy.apply(skill, out('demo'), { ...ctx, force: true });
    await expect(lstat(out('demo', 'extra.md'))).rejects.toThrow();
  });

  it('should replace a symlink with real files only when forced', async () => {
    await symlinkStrategy.apply(skill, out('demo'), ctx);
    expect(await copyStrategy.apply(skill, out('demo'), ctx)).toEqual({ action: 'skipped', reason: 'exists' });
    await copyStrategy.apply(skill, out('demo'), { ...ctx, force: true });
    expect((await lstat(out('demo'))).isSymbolicLink()).toBe(false);
  });
});

describe('given the override strategy', () => {
  it('should render markdown files for the active tags and copy the rest', async () => {
    expect(await overrideStrategy.apply(skill, out('demo'), ctx)).toEqual({ action: 'rendered' });
    expect(await readFile(out('demo', 'SKILL.md'), 'utf8')).toBe('---\nname: demo\ndescription: d\n---\nCodex.\nAll.\n');
    expect(await readFile(out('demo', 'references', 'notes.md'), 'utf8')).toBe('notes\n');
    expect(await readFile(out('demo', 'run.sh'), 'utf8')).toBe('<!-- ahm:omit -->\n');
  });

  it('should render per target', async () => {
    await overrideStrategy.apply(skill, out('demo'), { ...ctx, tags: ['claude-code'] });
    expect(await readFile(out('demo', 'SKILL.md'), 'utf8')).not.toContain('Codex.');
  });

  it('should be idempotent', async () => {
    await overrideStrategy.apply(skill, out('demo'), ctx);
    expect(await overrideStrategy.apply(skill, out('demo'), ctx)).toEqual({ action: 'skipped', reason: 'unchanged' });
  });

  it('should name the file when a block is malformed', async () => {
    await writeFile(context.sourcePath, '<!-- ahm:tag:x -->\n');
    await expect(overrideStrategy.apply(context, out('AGENTS.md'), ctx)).rejects.toThrow(
      `${context.sourcePath}: line 1: ahm:tag block is never closed`,
    );
  });
});

describe('given generated content', () => {
  it('should write it idempotently', async () => {
    expect(await writeGenerated(out('CLAUDE.md'), '@AGENTS.md\n', ctx)).toEqual({ action: 'rendered' });
    expect(await writeGenerated(out('CLAUDE.md'), '@AGENTS.md\n', ctx)).toEqual({ action: 'skipped', reason: 'unchanged' });
    expect(await writeGenerated(out('CLAUDE.md'), 'other', ctx)).toEqual({ action: 'skipped', reason: 'exists' });
  });
});
