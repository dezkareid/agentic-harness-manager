import { mkdir, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import type { StrategyName } from '../config/schema.js';
import type { HarnessItem } from '../core/types.js';
import { inspect, materialize, readTree, removePath } from './fs.js';
import { isRenderable, RenderError, renderTags } from './render.js';
import type { ExportResult, Strategy, StrategyContext } from './types.js';

/** Errors that mean "this filesystem cannot symlink here", so copying is the right fallback. */
const SYMLINK_UNSUPPORTED = new Set(['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'EXDEV']);

export const copyStrategy: Strategy = {
  name: 'copy',
  apply: async (item, destPath, ctx) =>
    materialize(destPath, await readTree(item.sourcePath, item.isDirectory), item.isDirectory, 'copied', ctx),
};

const renderTree = async (item: HarnessItem, tags: string[]) => {
  const tree = await readTree(item.sourcePath, item.isDirectory);
  for (const [relative, content] of tree) {
    const file = relative || path.basename(item.sourcePath);
    if (!isRenderable(file)) {
      continue;
    }
    try {
      tree.set(relative, Buffer.from(renderTags(content.toString('utf8'), tags)));
    }
    catch (error) {
      if (error instanceof RenderError) {
        throw new RenderError(`${path.join(item.sourcePath, relative)}: ${error.message}`);
      }
      throw error;
    }
  }
  return tree;
};

/** Renders tag blocks for the active tags and always writes real files. */
export const overrideStrategy: Strategy = {
  name: 'override',
  apply: async (item, destPath, ctx) =>
    materialize(destPath, await renderTree(item, ctx.tags), item.isDirectory, 'rendered', ctx),
};

const copyInstead = async (
  item: HarnessItem,
  destPath: string,
  ctx: StrategyContext,
  reason: string,
): Promise<ExportResult> => {
  const result = await copyStrategy.apply(item, destPath, ctx);
  return result.action === 'copied' ? { action: 'copied', reason } : result;
};

/**
 * Links the destination to the source with a relative symlink. Skills are linked as whole
 * directories because Codex follows directory symlinks but never file symlinks.
 */
export const symlinkStrategy: Strategy = {
  name: 'symlink',
  apply: async (item, destPath, ctx) => {
    if (ctx.noSymlink) {
      return copyInstead(item, destPath, ctx, 'symlinks disabled');
    }
    const existing = await inspect(destPath);
    const source = await realpath(item.sourcePath);
    if (existing.kind === 'symlink' && (await realpath(destPath).catch(() => undefined)) === source) {
      return { action: 'skipped', reason: 'unchanged' };
    }
    if (existing.kind !== 'missing' && !ctx.force) {
      return { action: 'skipped', reason: 'exists' };
    }
    if (ctx.dryRun) {
      return { action: 'linked' };
    }
    if (existing.kind !== 'missing') {
      await removePath(destPath);
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    try {
      // Relative to the real parent so links survive symlinked path segments (e.g. /var → /private/var).
      const parent = await realpath(path.dirname(destPath));
      await symlink(path.relative(parent, source), destPath, item.isDirectory ? 'dir' : 'file');
      return { action: 'linked' };
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!SYMLINK_UNSUPPORTED.has(code)) {
        throw error;
      }
      ctx.warn(`${destPath}: cannot create symlink (${code}), copying instead`);
      return copyInstead(item, destPath, ctx, `symlink failed (${code})`);
    }
  },
};

export const STRATEGIES: Record<StrategyName, Strategy> = {
  symlink: symlinkStrategy,
  copy: copyStrategy,
  override: overrideStrategy,
};

export const getStrategy = (name: StrategyName): Strategy => STRATEGIES[name];

export type { ExportAction, ExportResult, Strategy, StrategyContext } from './types.js';
export { writeGenerated } from './fs.js';
export { renderTags, RenderError } from './render.js';
