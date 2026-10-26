import { z } from 'zod';
import type { CliOptions } from '../config/resolve.js';
import { ConfigError, STRATEGY_NAMES, strategySchema, TARGET_IDS, targetIdSchema } from '../config/schema.js';

/** Raw commander options shared by `export` and `list`. */
export interface RawCommandOptions {
  target?: string[];
  out?: string;
  strategy?: string;
  omit?: string[];
  tag?: string[];
  config?: string;
  format?: string;
  dryRun?: boolean;
  force?: boolean;
  /** `--no-symlink` sets this to false. */
  symlink?: boolean;
}

export const OUTPUT_FORMATS = ['table', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Commander collector for repeatable flags. */
export const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** Splits `--target codex,antigravity --target strands` into ids. */
const splitList = (values: string[] = []): string[] =>
  values.flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);

const parseWith = <T>(schema: z.ZodType<T>, value: unknown, flag: string, expected: readonly string[]): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ConfigError(`${flag}: invalid value ${JSON.stringify(value)} (expected ${expected.join(', ')})`);
  }
  return result.data;
};

/** Validates CLI flags into the shape `resolveConfig` merges over the config file. */
export const toCliOptions = (raw: RawCommandOptions): CliOptions => {
  const targets = splitList(raw.target).map(id => parseWith(targetIdSchema, id, '--target', TARGET_IDS));
  return {
    outputDir: raw.out,
    targets: targets.length > 0 ? targets : undefined,
    strategy: raw.strategy === undefined ? undefined : parseWith(strategySchema, raw.strategy, '--strategy', STRATEGY_NAMES),
    omit: raw.omit,
    tags: raw.tag,
  };
};

export const toFormat = (value: string | undefined): OutputFormat =>
  parseWith(z.enum(OUTPUT_FORMATS), value ?? 'table', '--format', OUTPUT_FORMATS);
