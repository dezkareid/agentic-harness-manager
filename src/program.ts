import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };

export const createProgram = (): Command =>
  new Command()
    .name('ahm')
    .description(pkg.description)
    .version(pkg.version);
