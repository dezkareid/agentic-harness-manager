import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Harness, HarnessItem } from '../core/types.js';
import { materialize, textTree } from '../strategies/fs.js';
import { renderTags } from '../strategies/render.js';
import type { TargetContext, TargetOutput } from './types.js';

const IMPORT_LINE = /^\s*@(\S+)\s*$/;
const MAX_IMPORT_DEPTH = 5;

/**
 * Inlines Claude-style `@path` imports (a line holding only `@relative/path`) so agents
 * without import support see the full text. Paths resolve against the importing file.
 */
export const flattenImports = async (file: string, seen: string[] = []): Promise<string> => {
  if (seen.includes(file)) {
    throw new Error(`${file}: circular @import (${[...seen, file].join(' → ')})`);
  }
  if (seen.length > MAX_IMPORT_DEPTH) {
    throw new Error(`${file}: @imports nested deeper than ${MAX_IMPORT_DEPTH} levels`);
  }
  const lines = (await readFile(file, 'utf8')).split('\n');
  const output: string[] = [];
  for (const line of lines) {
    const match = IMPORT_LINE.exec(line);
    if (!match) {
      output.push(line);
      continue;
    }
    const imported = path.resolve(path.dirname(file), match[1]);
    output.push((await flattenImports(imported, [...seen, file])).replace(/\n$/, ''));
  }
  return output.join('\n');
};

/** Context files that another context file pulls in with `@path`; flattened targets inline them. */
export const importedContextFiles = async (harness: Harness): Promise<Set<string>> => {
  const imported = new Set<string>();
  for (const item of harness.items.filter(entry => entry.kind === 'context')) {
    for (const line of (await readFile(item.sourcePath, 'utf8')).split('\n')) {
      const match = IMPORT_LINE.exec(line);
      if (match) {
        imported.add(path.resolve(path.dirname(item.sourcePath), match[1]));
      }
    }
  }
  return imported;
};

export const INLINED_REASON = 'inlined into the importing context file';

/**
 * Writes a context file as a real, flattened file. Used by targets that cannot follow
 * file symlinks or `@` imports. Warns when the result exceeds the agent's size budget.
 */
export const writeFlattenedContext = async (
  item: HarnessItem,
  dest: string,
  ctx: TargetContext,
  maxBytes: number,
): Promise<TargetOutput[]> => {
  if ((await importedContextFiles(ctx.harness)).has(item.sourcePath)) {
    return [{ dest, action: 'skipped', reason: INLINED_REASON }];
  }
  const override = ctx.settings.strategy === 'override';
  let text = await flattenImports(item.sourcePath);
  if (override) {
    text = renderTags(text, ctx.settings.tags);
  }
  const content = Buffer.from(text);
  if (content.length > maxBytes) {
    ctx.strategy.warn(`${dest}: ${content.length} bytes exceeds the ${maxBytes}-byte context budget; the agent may truncate it`);
  }
  const result = await materialize(dest, textTree(content), false, override ? 'rendered' : 'copied', ctx.strategy);
  return [{ dest, ...result }];
};
