import path from 'node:path';
import { HARNESS_KINDS } from '../core/types.js';
import type { HarnessItem, HarnessKind } from '../core/types.js';
import type { LoadedConfig } from './load.js';
import type { ItemOverride, StrategyName, TargetId } from './schema.js';

/** Values given on the command line. Every field is optional and wins over the config file. */
export interface CliOptions {
  source?: string;
  outputDir?: string;
  targets?: TargetId[];
  strategy?: StrategyName;
  omit?: string[];
  tags?: string[];
}

export interface ResolvedTarget {
  id: TargetId;
  outputDir?: string;
  strategy?: StrategyName;
  tags: string[];
  omit: string[];
}

export interface ResolvedConfig {
  source: string;
  outputDir: string;
  targets: ResolvedTarget[];
  defaultStrategy?: StrategyName;
  omit: string[];
  overrides: Record<string, ItemOverride>;
  cli: CliOptions;
}

export interface ItemSettings {
  strategy: StrategyName;
  /** Active tags: the target id plus every configured tag. */
  tags: string[];
  outputDir: string;
  omitted: boolean;
}

/** Strategy used when nothing else is configured. */
export const TARGET_DEFAULT_STRATEGY: Record<TargetId, StrategyName> = {
  'claude-code': 'symlink',
  'codex': 'symlink',
  'antigravity': 'copy',
  'strands': 'copy',
};

const globToRegExp = (glob: string): RegExp => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
};

/** Matches `kind:glob` selectors against kind and name, and bare globs against the name only. */
export const matchesSelector = (selector: string, item: Pick<HarnessItem, 'kind' | 'name'>): boolean => {
  const separator = selector.indexOf(':');
  const kind = separator === -1 ? undefined : selector.slice(0, separator);
  if (kind !== undefined && HARNESS_KINDS.includes(kind as HarnessKind)) {
    return kind === item.kind && globToRegExp(selector.slice(separator + 1)).test(item.name);
  }
  return globToRegExp(selector).test(item.name);
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Combines the loaded config and CLI flags into the values the export pipeline needs. */
export const resolveConfig = (loaded: LoadedConfig, cli: CliOptions, cwd: string): ResolvedConfig => {
  const { config, baseDir } = loaded;
  const configured = new Map<TargetId, ResolvedTarget>(
    config.targets.map((target) => {
      const entry = typeof target === 'string' ? { id: target } : target;
      return [
        entry.id,
        {
          id: entry.id,
          outputDir: entry.outputDir && path.resolve(baseDir, entry.outputDir),
          strategy: entry.strategy,
          tags: entry.tags ?? [],
          omit: entry.omit ?? [],
        },
      ];
    }),
  );
  const ids = cli.targets?.length ? unique(cli.targets) : [...configured.keys()];

  return {
    source: cli.source ? path.resolve(cwd, cli.source) : path.resolve(baseDir, config.source),
    outputDir: cli.outputDir ? path.resolve(cwd, cli.outputDir) : path.resolve(baseDir, config.outputDir),
    targets: ids.map(id => configured.get(id) ?? { id, tags: [], omit: [] }),
    defaultStrategy: config.defaultStrategy,
    omit: config.omit,
    overrides: Object.fromEntries(
      Object.entries(config.overrides).map(([selector, override]) => [
        selector,
        { ...override, outputDir: override.outputDir && path.resolve(baseDir, override.outputDir) },
      ]),
    ),
    cli,
  };
};

/**
 * Settings for one item in one target. Scalars follow
 * CLI flags > per-target config > per-item override > global config > defaults;
 * `tags` and `omit` accumulate across every level.
 */
export const resolveItemSettings = (
  config: ResolvedConfig,
  target: ResolvedTarget,
  item: Pick<HarnessItem, 'kind' | 'name'>,
): ItemSettings => {
  const overrides = Object.entries(config.overrides)
    .filter(([selector]) => matchesSelector(selector, item))
    .map(([, override]) => override);
  const fromOverrides = <K extends keyof ItemOverride>(key: K): ItemOverride[K] =>
    overrides.findLast(override => override[key] !== undefined)?.[key];

  const omit = [...config.omit, ...target.omit, ...(config.cli.omit ?? [])];

  return {
    strategy:
      config.cli.strategy
      ?? target.strategy
      ?? fromOverrides('strategy')
      ?? config.defaultStrategy
      ?? TARGET_DEFAULT_STRATEGY[target.id],
    tags: unique([
      target.id,
      ...(config.cli.tags ?? []),
      ...target.tags,
      ...overrides.flatMap(override => override.tags ?? []),
    ]),
    outputDir:
      (config.cli.outputDir ? config.outputDir : undefined)
      ?? target.outputDir
      ?? fromOverrides('outputDir')
      ?? config.outputDir,
    omitted: omit.some(selector => matchesSelector(selector, item)),
  };
};
