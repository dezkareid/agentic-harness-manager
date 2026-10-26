import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { HarnessItem } from '../core/types.js';
import { inspect, materialize, textTree } from '../strategies/fs.js';
import type { StrategyContext } from '../strategies/types.js';
import type { TargetOutput } from './types.js';

/** Claude-shaped hooks: event name → matcher groups. */
export type HooksByEvent = Record<string, unknown[]>;

const pushUnique = (list: unknown[], entry: unknown): void => {
  if (!list.some(existing => isDeepStrictEqual(existing, entry))) {
    list.push(entry);
  }
};

/** Deep-merges hook files by event, keeping order and dropping identical entries. */
export const mergeHooks = (...sources: HooksByEvent[]): HooksByEvent => {
  const merged: HooksByEvent = {};
  for (const source of sources) {
    for (const [event, entries] of Object.entries(source)) {
      merged[event] ??= [];
      entries.forEach(entry => pushUnique(merged[event], entry));
    }
  }
  return merged;
};

export const hooksOf = (item: HarnessItem): HooksByEvent =>
  (item.content as { hooks?: HooksByEvent } | undefined)?.hooks ?? {};

const readJsonObject = async (file: string): Promise<Record<string, unknown>> => {
  const existing = await inspect(file);
  if (existing.kind === 'missing') {
    return {};
  }
  const data: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${file}: expected a JSON object`);
  }
  return data as Record<string, unknown>;
};

/**
 * Rewrites a JSON object file through `update`. Merging never needs `--force`; when the data
 * is unchanged the user's file (and its formatting) is left alone.
 */
export const updateJsonFile = async (
  file: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>,
  ctx: StrategyContext,
): Promise<TargetOutput> => {
  const exists = (await inspect(file)).kind !== 'missing';
  const current = await readJsonObject(file);
  const next = update(current);
  if (exists && isDeepStrictEqual(current, next)) {
    return { dest: file, action: 'skipped', reason: 'unchanged' };
  }
  const content = `${JSON.stringify(next, null, 2)}\n`;
  return { dest: file, ...(await materialize(file, textTree(content), false, 'merged', { ...ctx, force: true })) };
};

/** Merges `hooks` into the `hooks` key of a JSON settings file without touching other keys. */
export const mergeHooksIntoJson = (file: string, hooks: HooksByEvent, ctx: StrategyContext): Promise<TargetOutput> =>
  updateJsonFile(file, current => ({ ...current, hooks: mergeHooks((current.hooks ?? {}) as HooksByEvent, hooks) }), ctx);
