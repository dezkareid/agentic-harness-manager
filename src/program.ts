import { Command, CommanderError, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { formatJson, formatTable, summarize } from './cli/format.js';
import { collect, OUTPUT_FORMATS, toCliOptions, toFormat } from './cli/options.js';
import type { RawCommandOptions } from './cli/options.js';
import { loadConfig, writeStarterConfig } from './config/load.js';
import { resolveConfig } from './config/resolve.js';
import { ConfigError, STRATEGY_NAMES, TARGET_IDS } from './config/schema.js';
import { loadHarness } from './core/loader.js';
import { HarnessLoadError } from './core/types.js';
import { ExportError, exportHarness } from './export/run.js';
import type { ExportEntry } from './export/run.js';
import { TARGETS } from './targets/index.js';
import { logger as defaultLogger } from './utils/logger.js';
import type { Logger } from './utils/logger.js';

export const EXIT = {
  ok: 0,
  invalid: 1,
  exportFailed: 2,
  interrupted: 130,
} as const;

export interface ProgramDeps {
  cwd?: string;
  logger?: Logger;
}

interface ProgramState {
  exitCode: number;
}

const EXPORT_EXAMPLES = `
Examples:
  $ ahm export                                  # targets from ahm.config.json
  $ ahm export --target claude-code,codex       # one-off target selection
  $ ahm export --target strands --out ./agent   # write into another directory
  $ ahm export --omit 'hook:*' --tag internal   # skip hooks, enable a tag
  $ ahm export --dry-run --format json          # machine-readable plan
`;

const LIST_EXAMPLES = `
Examples:
  $ ahm list
  $ ahm list --target codex --format json
`;

const INIT_EXAMPLES = `
Examples:
  $ ahm init
  $ ahm init --force
`;

const addSharedOptions = (command: Command): Command =>
  command
    .option('-t, --target <ids>', `targets to export to, comma-separated or repeated (${TARGET_IDS.join(', ')})`, collect)
    .option('-o, --out <dir>', 'output directory (overrides outputDir)')
    .addOption(new Option('-s, --strategy <name>', 'strategy for every item').choices(STRATEGY_NAMES))
    .option('--omit <selector>', 'skip items: kind:glob or a name glob (repeatable)', collect)
    .option('--tag <tag>', 'extra tag for override blocks (repeatable)', collect)
    .option('-c, --config <path>', 'config file (default: ahm.config.json, ahm.config.yaml or package.json#ahm)')
    .addOption(new Option('-f, --format <format>', 'output format').choices(OUTPUT_FORMATS).default('table'));

/** Loads config and harness, runs the export (or plan) and prints the result. */
const runExport = async (
  raw: RawCommandOptions,
  dryRun: boolean,
  { cwd, logger }: Required<ProgramDeps>,
): Promise<number> => {
  const format = toFormat(raw.format);
  const loaded = await loadConfig(cwd, raw.config);
  logger.debug(loaded.path ? `config: ${loaded.path}` : 'config: defaults');
  const config = resolveConfig(loaded, toCliOptions(raw), cwd);
  logger.debug(`source: ${config.source}`);
  const { harness, warnings } = await loadHarness(config.source);
  warnings.forEach(warning => logger.warn(warning));

  const entries: ExportEntry[] = await exportHarness(harness, config, TARGETS, {
    dryRun,
    force: raw.force,
    noSymlink: raw.symlink === false,
    warn: message => logger.warn(message),
  });

  logger.print(format === 'json' ? formatJson(entries) : formatTable(entries, cwd));
  if (format === 'table') {
    logger.info(`${dryRun ? 'Dry run: ' : ''}${summarize(entries)}`);
  }
  const conflicts = entries.filter(entry => entry.reason === 'exists').length;
  if (conflicts > 0) {
    logger.warn(`${conflicts} destination(s) differ from the harness; re-run with --force to replace them`);
  }
  return entries.some(entry => entry.action === 'failed') ? EXIT.exportFailed : EXIT.ok;
};

export const createProgram = (deps: ProgramDeps = {}, state: ProgramState = { exitCode: EXIT.ok }): Command => {
  const resolved: Required<ProgramDeps> = { cwd: deps.cwd ?? process.cwd(), logger: deps.logger ?? defaultLogger };
  const { logger } = resolved;

  const program = new Command()
    .name('ahm')
    .description(pkg.description)
    .version(pkg.version)
    .option('-q, --quiet', 'only print command output, warnings and errors')
    .option('-v, --verbose', 'print debug information')
    .configureOutput({ writeOut: text => logger.print(text), writeErr: text => logger.printError(text) })
    .exitOverride()
    .hook('preAction', () => {
      const { quiet, verbose } = program.opts<{ quiet?: boolean; verbose?: boolean }>();
      logger.setLevel(quiet ? 'quiet' : verbose ? 'verbose' : 'normal');
    });

  addSharedOptions(
    program
      .command('export')
      .description('export the harness into each target\'s on-disk layout')
      .option('--dry-run', 'print what would be written without touching the filesystem')
      .option('--force', 'replace destinations that differ from the harness')
      .option('--no-symlink', 'copy instead of creating symlinks'),
  )
    .addHelpText('after', EXPORT_EXAMPLES)
    .action(async (raw: RawCommandOptions) => {
      state.exitCode = await runExport(raw, raw.dryRun ?? false, resolved);
    });

  addSharedOptions(
    program
      .command('list')
      .description('print the export plan (item × target × strategy × destination) without writing'),
  )
    .addHelpText('after', LIST_EXAMPLES)
    .action(async (raw: RawCommandOptions) => {
      state.exitCode = await runExport(raw, true, resolved);
    });

  program
    .command('init')
    .description('write a commented starter ahm.config.json')
    .option('--force', 'overwrite an existing ahm.config.json')
    .addHelpText('after', INIT_EXAMPLES)
    .action(async (options: { force?: boolean }) => {
      const file = await writeStarterConfig(resolved.cwd, options.force);
      logger.info(`Created ${file}`);
    });

  return program;
};

const isValidationError = (error: unknown): boolean =>
  error instanceof ConfigError || error instanceof HarnessLoadError || error instanceof ExportError;

/**
 * Runs the CLI and returns the exit code: 0 success, 1 validation/config error,
 * 2 export errors (some items failed). 130 (interrupted) is set by the entry point.
 */
export const run = async (argv: string[], deps: ProgramDeps = {}): Promise<number> => {
  const logger = deps.logger ?? defaultLogger;
  const state: ProgramState = { exitCode: EXIT.ok };
  try {
    await createProgram(deps, state).parseAsync(argv, { from: 'user' });
    return state.exitCode;
  }
  catch (error) {
    if (error instanceof CommanderError) {
      // Help and version also arrive here, with exit code 0; usage errors were already printed.
      return error.exitCode === 0 ? EXIT.ok : EXIT.invalid;
    }
    logger.error(error instanceof Error ? error.message : String(error));
    return isValidationError(error) ? EXIT.invalid : EXIT.exportFailed;
  }
};
