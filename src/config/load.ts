import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseJsonc } from './jsonc.js';
import { ConfigError, parseConfig } from './schema.js';
import type { AhmConfig } from './schema.js';

export const CONFIG_FILES = ['ahm.config.json', 'ahm.config.yaml'] as const;

export interface LoadedConfig {
  config: AhmConfig;
  /** File the config came from; undefined when defaults were used. */
  path?: string;
  /** Directory relative paths in the config resolve against. */
  baseDir: string;
}

const exists = async (file: string): Promise<boolean> =>
  access(file).then(() => true, () => false);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const readConfigFile = async (file: string): Promise<unknown> => {
  const source = await readFile(file, 'utf8');
  try {
    return /\.ya?ml$/.test(file) ? parseYaml(source) : parseJsonc(source);
  }
  catch (error) {
    throw new ConfigError(`Cannot parse ${file}: ${errorMessage(error)}`);
  }
};

/**
 * Finds and validates the config. Discovery order: `--config <path>`, `ahm.config.json`,
 * `ahm.config.yaml`, then the `"ahm"` key in `package.json`. Falls back to defaults.
 */
export const loadConfig = async (cwd: string, configPath?: string): Promise<LoadedConfig> => {
  if (configPath) {
    const file = path.resolve(cwd, configPath);
    if (!(await exists(file))) {
      throw new ConfigError(`Config file not found: ${file}`);
    }
    const data = file.endsWith('package.json') ? ((await readConfigFile(file)) as { ahm?: unknown }).ahm : await readConfigFile(file);
    return { config: parseConfig(data, file), path: file, baseDir: path.dirname(file) };
  }

  for (const name of CONFIG_FILES) {
    const file = path.join(cwd, name);
    if (await exists(file)) {
      return { config: parseConfig(await readConfigFile(file), file), path: file, baseDir: cwd };
    }
  }

  const pkgFile = path.join(cwd, 'package.json');
  if (await exists(pkgFile)) {
    const pkg = (await readConfigFile(pkgFile)) as { ahm?: unknown };
    if (pkg.ahm !== undefined) {
      return { config: parseConfig(pkg.ahm, `${pkgFile} ("ahm" key)`), path: pkgFile, baseDir: cwd };
    }
  }

  return { config: parseConfig({}, 'defaults'), baseDir: cwd };
};

export const STARTER_CONFIG = `{
  // ahm configuration — https://github.com/dezkareid/agentic-harness-manager#configuration
  // CLI flags always win over values in this file.

  // Folder with skills/, context/, hooks/ and agents/.
  "source": "./harness",

  // Root directory the target trees are written to.
  "outputDir": ".",

  // Targets to export to: "claude-code", "codex", "antigravity", "strands".
  // Use an object for per-target settings: { "id": "codex", "strategy": "copy", "omit": ["hook:*"] }
  "targets": ["claude-code"],

  // "symlink", "copy" or "override". Leave unset to use each target's default.
  // "defaultStrategy": "symlink",

  // Items to skip: "kind:glob" selectors (e.g. "skill:internal-*", "hook:*") or name globs.
  "omit": [],

  // Per-item settings keyed by selector.
  // "overrides": { "context:AGENTS.md": { "strategy": "override", "tags": ["team"] } }
  "overrides": {}
}
`;

/** Writes the commented starter `ahm.config.json`. Refuses to overwrite unless `force` is set. */
export const writeStarterConfig = async (cwd: string, force = false): Promise<string> => {
  const file = path.join(cwd, CONFIG_FILES[0]);
  if (!force && (await exists(file))) {
    throw new ConfigError(`${file} already exists (use --force to overwrite)`);
  }
  await writeFile(file, STARTER_CONFIG, 'utf8');
  return file;
};
