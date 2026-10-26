import { z } from 'zod';

export const TARGET_IDS = ['claude-code', 'codex', 'antigravity', 'strands'] as const;
export const STRATEGY_NAMES = ['symlink', 'copy', 'override'] as const;

export type TargetId = (typeof TARGET_IDS)[number];
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export const targetIdSchema = z.enum(TARGET_IDS);
export const strategySchema = z.enum(STRATEGY_NAMES);

/** `kind:glob` (e.g. `skill:internal-*`, `hook:*`) or a bare glob matched against the item name. */
export const selectorSchema = z.string().min(1);

export const itemOverrideSchema = z.strictObject({
  strategy: strategySchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
  outputDir: z.string().min(1).optional(),
});

export const targetObjectSchema = z.strictObject({
  id: targetIdSchema,
  outputDir: z.string().min(1).optional(),
  strategy: strategySchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
  omit: z.array(selectorSchema).optional(),
});

export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  source: z.string().min(1).default('./harness'),
  outputDir: z.string().min(1).default('.'),
  targets: z.array(z.union([targetIdSchema, targetObjectSchema])).default([]),
  /** When unset, each target falls back to its own default strategy. */
  defaultStrategy: strategySchema.optional(),
  omit: z.array(selectorSchema).default([]),
  overrides: z.record(selectorSchema, itemOverrideSchema).default({}),
});

export type ItemOverride = z.infer<typeof itemOverrideSchema>;
export type TargetConfig = z.infer<typeof targetObjectSchema>;
export type AhmConfig = z.infer<typeof configSchema>;
export type AhmConfigInput = z.input<typeof configSchema>;

const formatPath = (segments: readonly PropertyKey[]): string =>
  segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`;
    }
    return acc ? `${acc}.${String(segment)}` : String(segment);
  }, '');

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validates raw config data, throwing a ConfigError that names every offending key path. */
export const parseConfig = (data: unknown, origin: string): AhmConfig => {
  const result = configSchema.safeParse(data ?? {});
  if (result.success) {
    return result.data;
  }
  const lines = result.error.issues.map((issue) => {
    const keyPath = formatPath(issue.path);
    return `  ${keyPath || '(root)'}: ${issue.message}`;
  });
  throw new ConfigError(`Invalid config in ${origin}:\n${lines.join('\n')}`);
};
