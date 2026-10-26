export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const createLogger = (
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
): Logger => ({
  info: (message) => {
    stdout.write(`${message}\n`);
  },
  warn: (message) => {
    stderr.write(`warn: ${message}\n`);
  },
  error: (message) => {
    stderr.write(`error: ${message}\n`);
  },
});

export const logger = createLogger();
