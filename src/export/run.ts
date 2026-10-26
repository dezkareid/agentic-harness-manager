import path from 'node:path';
import { resolveItemSettings } from '../config/resolve.js';
import type { ResolvedConfig, ResolvedTarget } from '../config/resolve.js';
import type { TargetId } from '../config/schema.js';
import type { Harness, HarnessItem, HarnessKind } from '../core/types.js';
import { getStrategy } from '../strategies/index.js';
import type { ExportAction, StrategyContext } from '../strategies/types.js';
import type { ExportedItem, Target, TargetContext, TargetOutput } from '../targets/types.js';

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

/** Real-file writers go first so shared destinations (`.agents/skills`, `AGENTS.md`) are never symlinks. */
export const EXPORT_ORDER: TargetId[] = ['antigravity', 'strands', 'codex', 'claude-code'];

interface TargetRun {
  target: Target;
  resolved: ResolvedTarget;
  harness: Harness;
  config: ResolvedConfig;
  strategy: StrategyContext;
  entries: ExportEntry[];
  /** Destinations already written in this run, across targets. */
  claims: Map<string, TargetId>;
  /** Exported items per output directory, for postProcess. */
  groups: Map<string, { exported: ExportedItem[]; merged: ExportedItem[] }>;
}

const groupFor = (run: TargetRun, outputDir: string) => {
  const group = run.groups.get(outputDir) ?? { exported: [], merged: [] };
  run.groups.set(outputDir, group);
  return group;
};

const writeItem = async (run: TargetRun, item: HarnessItem, dest: string, ctx: TargetContext): Promise<TargetOutput[]> => {
  const owner = run.claims.get(dest);
  if (owner) {
    return [{ dest, action: 'shared', reason: `written by ${owner}` }];
  }
  const outputs = run.target.transform
    ? await run.target.transform(item, dest, ctx)
    : [{ dest, ...(await getStrategy(ctx.settings.strategy).apply(item, dest, { ...run.strategy, tags: ctx.settings.tags })) }];
  assertInside(ctx.outputDir, outputs);
  outputs.forEach(output => run.claims.set(output.dest, run.target.id));
  return outputs;
};

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

  const group = groupFor(run, settings.outputDir);
  if (layout.mode === 'merge') {
    group.merged.push({ item, settings });
    return;
  }
  group.exported.push({ item, settings });
  const outputs = await writeItem(run, item, dest, ctx);
  run.entries.push(...outputs.map(output => ({ ...base, ...output })));
};

const exportTarget = async (run: TargetRun): Promise<void> => {
  for (const item of run.harness.items) {
    await exportItem(run, item);
  }
  if (!run.target.postProcess) {
    return;
  }
  for (const [outputDir, group] of run.groups) {
    const outputs = await run.target.postProcess({ harness: run.harness, outputDir, strategy: run.strategy, ...group });
    assertInside(outputDir, outputs);
    run.entries.push(...outputs.map(output => ({ target: run.target.id, ...output })));
  }
};

/** Exports the harness to every resolved target and returns one entry per destination. */
export const exportHarness = async (
  harness: Harness,
  config: ResolvedConfig,
  targets: Record<TargetId, Target>,
  options: ExportOptions,
): Promise<ExportEntry[]> => {
  if (config.targets.length === 0) {
    throw new ExportError('No targets selected: pass --target or set "targets" in the config');
  }
  const entries: ExportEntry[] = [];
  const claims = new Map<string, TargetId>();
  const ordered = [...config.targets].sort((a, b) => EXPORT_ORDER.indexOf(a.id) - EXPORT_ORDER.indexOf(b.id));
  for (const resolved of ordered) {
    await exportTarget({
      target: targets[resolved.id],
      resolved,
      harness,
      config,
      strategy: { tags: [resolved.id], force: options.force, dryRun: options.dryRun, noSymlink: options.noSymlink, warn: options.warn },
      entries,
      claims,
      groups: new Map(),
    });
  }
  return entries;
};
