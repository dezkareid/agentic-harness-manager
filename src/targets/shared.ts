import { getStrategy, writeGenerated } from '../strategies/index.js';
import { renderTags } from '../strategies/render.js';
import type { ItemSettings } from '../config/resolve.js';
import type { HarnessItem } from '../core/types.js';
import type { TargetContext, TargetOutput } from './types.js';

/** Exports an item with its resolved strategy, as the engine would without a transform. */
export const applyStrategy = async (item: HarnessItem, dest: string, ctx: TargetContext): Promise<TargetOutput[]> => [
  { dest, ...(await getStrategy(ctx.settings.strategy).apply(item, dest, { ...ctx.strategy, tags: ctx.settings.tags })) },
];

/** The item body, rendered through tag blocks when the item uses the override strategy. */
export const bodyOf = (item: HarnessItem, settings: ItemSettings): string => {
  const body = (item.body ?? '').replace(/^\n+/, '');
  return settings.strategy === 'override' ? renderTags(body, settings.tags) : body;
};

export const writeText = async (dest: string, content: string, ctx: TargetContext): Promise<TargetOutput[]> => [
  { dest, ...(await writeGenerated(dest, content, ctx.strategy)) },
];
