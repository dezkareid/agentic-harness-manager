import type { ItemSettings } from '../config/resolve.js';
import type { StrategyName, TargetId } from '../config/schema.js';
import type { Harness, HarnessItem, HarnessKind } from '../core/types.js';
import type { ExportResult, StrategyContext } from '../strategies/types.js';

/**
 * - `dir`: the item becomes a directory (skills)
 * - `file`: the item becomes a single file
 * - `merge`: the item is folded into a shared file by `postProcess` (e.g. hooks into settings.json)
 */
export type LayoutMode = 'dir' | 'file' | 'merge';

export interface Layout {
  /** Destination relative to the target's output directory. */
  destPath: string;
  mode: LayoutMode;
}

export interface TargetContext {
  harness: Harness;
  /** Absolute output directory for this item; nothing may be written outside it. */
  outputDir: string;
  settings: ItemSettings;
  strategy: StrategyContext;
}

export interface PostProcessContext {
  harness: Harness;
  outputDir: string;
  strategy: StrategyContext;
  /** Items whose layout mode was `merge`, in harness order. */
  merged: HarnessItem[];
}

/** One file or directory written (or skipped) for an item. */
export interface TargetOutput extends ExportResult {
  /** Absolute destination path. */
  dest: string;
}

export interface Target {
  id: TargetId;
  defaultStrategy: StrategyName;
  supports(kind: HarnessKind): boolean;
  layout(item: HarnessItem, ctx: TargetContext): Layout;
  /** Replaces the strategy for items that need target-specific content. */
  transform?(item: HarnessItem, dest: string, ctx: TargetContext): Promise<TargetOutput[]>;
  /** Runs once per target after every item, e.g. to merge hooks or write shims. */
  postProcess?(ctx: PostProcessContext): Promise<TargetOutput[]>;
}
