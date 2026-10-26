import { lstat, mkdir, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExportAction, ExportResult, StrategyContext } from './types.js';

/** File contents keyed by path relative to the item root; a single file uses the key `''`. */
export type Tree = Map<string, Buffer>;

export type Existing
  = | { kind: 'missing' }
    | { kind: 'symlink'; target: string }
    | { kind: 'file' }
    | { kind: 'directory' };

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

export const inspect = async (dest: string): Promise<Existing> => {
  try {
    const stats = await lstat(dest);
    if (stats.isSymbolicLink()) {
      return { kind: 'symlink', target: path.resolve(path.dirname(dest), await readlink(dest)) };
    }
    return { kind: stats.isDirectory() ? 'directory' : 'file' };
  }
  catch (error) {
    if (isMissing(error)) {
      return { kind: 'missing' };
    }
    throw error;
  }
};

/** Reads a file or a directory (recursively, dotfiles included) into a Tree. */
export const readTree = async (source: string, isDirectory: boolean): Promise<Tree> => {
  if (!isDirectory) {
    return new Map([['', await readFile(source)]]);
  }
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  const tree: Tree = new Map();
  for (const entry of entries.filter(dirent => dirent.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    tree.set(path.relative(source, file).split(path.sep).join('/'), await readFile(file));
  }
  return tree;
};

export const treesEqual = (a: Tree, b: Tree): boolean =>
  a.size === b.size && [...a].every(([key, content]) => b.get(key)?.equals(content) ?? false);

const writeTree = async (dest: string, tree: Tree, isDirectory: boolean): Promise<void> => {
  if (!isDirectory) {
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, tree.get('') ?? Buffer.alloc(0));
    return;
  }
  await mkdir(dest, { recursive: true });
  for (const [relative, content] of tree) {
    const file = path.join(dest, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
};

const matchesExisting = async (dest: string, existing: Existing, tree: Tree, isDirectory: boolean): Promise<boolean> => {
  if (existing.kind !== (isDirectory ? 'directory' : 'file')) {
    return false;
  }
  return treesEqual(await readTree(dest, isDirectory), tree);
};

export const removePath = (dest: string): Promise<void> => rm(dest, { recursive: true, force: true });

/**
 * Writes `tree` as real files at `dest`, idempotently: identical content is reported as
 * `skipped (unchanged)`, differing content is replaced only with `force`.
 */
export const materialize = async (
  dest: string,
  tree: Tree,
  isDirectory: boolean,
  action: ExportAction,
  ctx: StrategyContext,
): Promise<ExportResult> => {
  const existing = await inspect(dest);
  if (existing.kind !== 'missing') {
    if (await matchesExisting(dest, existing, tree, isDirectory)) {
      return { action: 'skipped', reason: 'unchanged' };
    }
    if (!ctx.force) {
      return { action: 'skipped', reason: 'exists' };
    }
  }
  if (!ctx.dryRun) {
    if (existing.kind !== 'missing') {
      await removePath(dest);
    }
    await writeTree(dest, tree, isDirectory);
  }
  return { action };
};

/** Writes generated text (e.g. a target-specific file) with the same idempotency rules. */
export const writeGenerated = (dest: string, content: string, ctx: StrategyContext): Promise<ExportResult> =>
  materialize(dest, new Map([['', Buffer.from(content)]]), false, 'rendered', ctx);
