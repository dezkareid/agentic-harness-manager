import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessItem } from '../core/types.js';
import { symlinkStrategy } from './index.js';

const symlinkError = vi.hoisted(() => ({ code: 'EPERM' }));

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  symlink: vi.fn(async () => {
    throw Object.assign(new Error('symlink failed'), symlinkError);
  }),
}));

let root: string;
let item: HarnessItem;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ahm-fallback-'));
  const source = path.join(root, 'skills', 'demo');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), 'x');
  item = { kind: 'skill', name: 'demo', sourcePath: source, isDirectory: true };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('given a filesystem that cannot create symlinks', () => {
  it('should warn and copy instead', async () => {
    symlinkError.code = 'EPERM';
    const warn = vi.fn();
    const dest = path.join(root, 'out', 'demo');
    expect(await symlinkStrategy.apply(item, dest, { tags: [], warn })).toEqual({
      action: 'copied',
      reason: 'symlink failed (EPERM)',
    });
    expect(warn).toHaveBeenCalledWith(`${dest}: cannot create symlink (EPERM), copying instead`);
    expect((await lstat(path.join(dest, 'SKILL.md'))).isFile()).toBe(true);
  });

  it('should rethrow unrelated errors', async () => {
    symlinkError.code = 'ENOSPC';
    await expect(symlinkStrategy.apply(item, path.join(root, 'out', 'demo'), { tags: [], warn: vi.fn() })).rejects.toThrow(
      'symlink failed',
    );
  });
});
