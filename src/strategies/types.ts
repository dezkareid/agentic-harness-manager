import type { StrategyName } from '../config/schema.js';
import type { HarnessItem } from '../core/types.js';

export type ExportAction = 'linked' | 'copied' | 'rendered' | 'merged' | 'shared' | 'skipped' | 'failed';

export interface ExportResult {
  action: ExportAction;
  reason?: string;
}

export interface StrategyContext {
  /** Active tags for the override renderer (the target id plus configured tags). */
  tags: string[];
  /** Replace destinations that differ from what would be written. */
  force?: boolean;
  /** Never create symlinks; the symlink strategy copies instead. */
  noSymlink?: boolean;
  /** Report what would happen without touching the filesystem. */
  dryRun?: boolean;
  warn: (message: string) => void;
}

export interface Strategy {
  name: StrategyName;
  apply(item: HarnessItem, destPath: string, ctx: StrategyContext): Promise<ExportResult>;
}
