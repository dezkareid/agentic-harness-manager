import { EXIT, run } from './program.js';

process.once('SIGINT', () => {
  process.exit(EXIT.interrupted);
});

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
