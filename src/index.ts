import { createProgram } from './program.js';
import { logger } from './utils/logger.js';

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
