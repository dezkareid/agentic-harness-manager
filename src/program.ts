import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { writeStarterConfig } from './config/load.js';
import { logger as defaultLogger } from './utils/logger.js';
import type { Logger } from './utils/logger.js';

export interface ProgramDeps {
  cwd?: string;
  logger?: Logger;
}

export const createProgram = ({ cwd = process.cwd(), logger = defaultLogger }: ProgramDeps = {}): Command => {
  const program = new Command()
    .name('ahm')
    .description(pkg.description)
    .version(pkg.version);

  program
    .command('init')
    .description('write a commented starter ahm.config.json')
    .option('-f, --force', 'overwrite an existing ahm.config.json')
    .action(async (options: { force?: boolean }) => {
      const file = await writeStarterConfig(cwd, options.force);
      logger.info(`Created ${file}`);
    });

  return program;
};
