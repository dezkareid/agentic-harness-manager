export type LogLevel = 'quiet' | 'normal' | 'verbose';

export interface Logger {
  /** Progress and summaries; hidden with --quiet. */
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Diagnostics; shown only with --verbose. */
  debug(message: string): void;
  /** Command output (tables, JSON, help) written verbatim to stdout, regardless of level. */
  print(text: string): void;
  /** Verbatim text for stderr (e.g. commander usage errors). */
  printError(text: string): void;
  setLevel(level: LogLevel): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Defaults to on when the stream is a TTY and NO_COLOR is unset. */
  color?: boolean;
}

const ANSI = { red: 31, yellow: 33, dim: 2 } as const;

const supportsColor = (stream: NodeJS.WritableStream): boolean =>
  Boolean((stream as NodeJS.WriteStream).isTTY) && !process.env.NO_COLOR;

export const createLogger = (
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
  options: LoggerOptions = {},
): Logger => {
  let level: LogLevel = options.level ?? 'normal';
  const color = options.color ?? supportsColor(stderr);
  const paint = (code: number, text: string): string => (color ? `\u001b[${code}m${text}\u001b[0m` : text);

  return {
    info: (message) => {
      if (level !== 'quiet') {
        stdout.write(`${message}\n`);
      }
    },
    warn: (message) => {
      stderr.write(`${paint(ANSI.yellow, 'warn:')} ${message}\n`);
    },
    error: (message) => {
      stderr.write(`${paint(ANSI.red, 'error:')} ${message}\n`);
    },
    debug: (message) => {
      if (level === 'verbose') {
        stderr.write(`${paint(ANSI.dim, `debug: ${message}`)}\n`);
      }
    },
    print: (text) => {
      stdout.write(text);
    },
    printError: (text) => {
      stderr.write(text);
    },
    setLevel: (next) => {
      level = next;
    },
  };
};

export const logger = createLogger();
