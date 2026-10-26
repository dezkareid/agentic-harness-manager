import path from 'node:path';
import { resolveItemSettings } from '../config/resolve.js';
import type { ResolvedConfig, ResolvedTarget } from '../config/resolve.js';
import type { TargetId } from '../config/schema.js';
import type { Harness, HarnessItem, HarnessKind } from '../core/types.js';
import { getStrategy } from '../strategies/index.js';
import type { ExportAction, StrategyContext } from '../strategies/types.js';
import type { Target, TargetContext, TargetOutput } from '../targets/types.js';

export interface ExportEntry {
  target: TargetId;
  kind?: HarnessKind;
  name?: string;
  /** Absolute destination, when the entry maps to a path. */
  dest?: string;
  action: ExportAction;
  reason?: string;
}

export interface ExportOptions {
  force?: boolean;
  dryRun?: boolean;
  noSymlink?: boolean;
  warn: (message: string) => void;
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

const isInside = (dir: string, file: string): boolean => {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const assertInside = (outputDir: string, outputs: TargetOutput[]): void => {
  const outside = outputs.find(output => !isInside(outputDir, output.dest));
  if (outside) {
    throw new ExportError(`${outside.dest}: refusing to write outside ${outputDir}`);
  }
};

interface TargetRun {
  target: Target;
  resolved: ResolvedTarget;
  harness: Harness;
  config: ResolvedConfig;
  strategy: StrategyContext;
  entries: ExportEntry[];
  merged: Map<string, HarnessItem[]>;
}

const exportItem = async (run: TargetRun, item: HarnessItem): Promise<void> => {
  const { target, resolved } = run;
  const base = { target: target.id, kind: item.kind, name: item.name };
  const settings = resolveItemSettings(run.config, resolved, item);
  if (settings.omitted) {
    run.entries.push({ ...base, action: 'skipped', reason: 'omitted' });
    return;
  }
  if (!target.supports(item.kind)) {
    run.entries.push({ ...base, action: 'skipped', reason: `${item.kind} not supported by ${target.id}` });
    return;
  }
  const ctx: TargetContext = { harness: run.harness, outputDir: settings.outputDir, settings, strategy: run.strategy };
  const layout = target.layout(item, ctx);
  const dest = path.join(settings.outputDir, layout.destPath);
  assertInside(settings.outputDir, [{ dest, action: 'skipped' }]);

  if (layout.mode === 'merge') {
    const group = run.merged.get(settings.outputDir) ?? [];
    group.push(item);
    run.merged.set(settings.outputDir, group);
    return;
  }
  const outputs = target.transform
    ? await target.transform(item, dest, ctx)
    : [{ dest, ...(await getStrategy(settings.strategy).apply(item, dest, { ...run.strategy, tags: settings.tags })) }];
  assertInside(settings.outputDir, outputs);
  run.entries.push(...outputs.map(output => ({ ...base, ...output })));
};

const exportTarget = async (run: TargetRun): Promise<void> => {
  for (const item of run.harness.items) {
    await exportItem(run, item);
  }
  for (const [outputDir, merged] of run.merged) {
    const outputs = (await run.target.postProcess?.({ harness: run.harness, outputDir, strategy: run.strategy, merged })) ?? [];
    assertInside(outputDir, outputs);
    run.entries.push(...outputs.map(output => ({ target: run.target.id, ...output })));
  }
};

/** Exports the harness to every resolved target and returns one entry per destination. */
export const exportHarness = async (
  harness: Harness,
  config: ResolvedConfig,
  targets: Partial<Record<TargetId, Target>>,
  options: ExportOptions,
): Promise<ExportEntry[]> => {
  if (config.targets.length === 0) {
    throw new ExportError('No targets selected: pass --target or set "targets" in the config');
  }
  const entries: ExportEntry[] = [];
  for (const resolved of config.targets) {
    const target = targets[resolved.id];
    if (!target) {
      throw new ExportError(`Target ${resolved.id} is not available`);
    }
    await exportTarget({
      target,
      resolved,
      harness,
      config,
      strategy: { tags: [resolved.id], force: options.force, dryRun: options.dryRun, noSymlink: options.noSymlink, warn: options.warn },
      entries,
      merged: new Map(),
    });
  }
  return entries;
};
