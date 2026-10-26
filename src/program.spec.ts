import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toCliOptions } from './cli/options.js';
import { STARTER_CONFIG } from './config/load.js';
import { EXIT, run } from './program.js';
import { createLogger } from './utils/logger.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'core', '__fixtures__', 'valid');

let cwd: string;
let stdout: string[];
let stderr: string[];

const sink = (into: string[]) => ({ write: (chunk: string) => into.push(chunk) }) as unknown as NodeJS.WritableStream;
const ahm = (...argv: string[]) => run(argv, { cwd, logger: createLogger(sink(stdout), sink(stderr), { color: false }) });
const out = () => stdout.join('');
const err = () => stderr.join('');

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'ahm-cli-'));
  stdout = [];
  stderr = [];
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('given CLI flags', () => {
  it('should split comma-separated and repeated targets', () => {
    expect(toCliOptions({ target: ['claude-code,codex', 'strands'] }).targets).toEqual(['claude-code', 'codex', 'strands']);
  });

  it('should map out, strategy, omit and tag', () => {
    expect(toCliOptions({ out: 'dist', strategy: 'copy', omit: ['hook:*'], tag: ['team'] })).toEqual({
      outputDir: 'dist',
      targets: undefined,
      strategy: 'copy',
      omit: ['hook:*'],
      tags: ['team'],
    });
  });

  it('should reject unknown targets', () => {
    expect(() => toCliOptions({ target: ['vim'] })).toThrow('--target: invalid value "vim"');
  });
});

describe('given --version and --help', () => {
  it('should print the version and exit 0', async () => {
    expect(await ahm('--version')).toBe(EXIT.ok);
    expect(out()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('should show per-command help with examples', async () => {
    expect(await ahm('export', '--help')).toBe(EXIT.ok);
    expect(out()).toContain('--dry-run');
    expect(out()).toContain('Examples:');
  });

  it('should exit 1 on unknown options', async () => {
    expect(await ahm('export', '--nope')).toBe(EXIT.invalid);
    expect(err()).toContain('unknown option \'--nope\'');
  });
});

describe('given ahm init', () => {
  it('should write the starter config into the working directory', async () => {
    expect(await ahm('init')).toBe(EXIT.ok);
    expect(await readFile(path.join(cwd, 'ahm.config.json'), 'utf8')).toBe(STARTER_CONFIG);
    expect(out()).toBe(`Created ${path.join(cwd, 'ahm.config.json')}\n`);
  });

  it('should exit 1 when the config exists and --force is missing', async () => {
    await ahm('init');
    expect(await ahm('init')).toBe(EXIT.invalid);
    expect(err()).toContain('already exists');
    expect(await ahm('init', '--force')).toBe(EXIT.ok);
  });
});

describe('given a harness and a config', () => {
  beforeEach(async () => {
    await writeFile(path.join(cwd, 'ahm.config.json'), JSON.stringify({ source: fixture, targets: ['codex'] }));
  });

  it('should export with flags merged over the config', async () => {
    expect(await ahm('export', '--target', 'claude-code', '--omit', 'hook:*')).toBe(EXIT.ok);
    expect(await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(out()).toContain('TARGET');
    expect(out()).toMatch(/claude-code\s+hook\s+format\s+-\s+skipped\s+-\s+omitted/);
    expect(out()).toContain('written, 0 shared, 1 skipped, 0 failed');
  });

  it('should emit one JSON document with --format json', async () => {
    expect(await ahm('export', '--format', 'json', '--quiet')).toBe(EXIT.ok);
    const entries = JSON.parse(out()) as Array<{ target: string; action: string }>;
    expect(entries.every(entry => entry.target === 'codex')).toBe(true);
    expect(entries.map(entry => entry.action)).toContain('linked');
  });

  it('should print the plan without writing for --dry-run and list', async () => {
    expect(await ahm('export', '--dry-run')).toBe(EXIT.ok);
    expect(out()).toContain('Dry run:');
    expect(await ahm('list', '--format', 'json')).toBe(EXIT.ok);
    expect(await readdir(cwd)).toEqual(['ahm.config.json']);
  });

  it('should warn about differing destinations', async () => {
    await writeFile(path.join(cwd, 'AGENTS.md'), 'mine');
    expect(await ahm('export')).toBe(EXIT.ok);
    expect(err()).toContain('re-run with --force');
  });

  it('should exit 2 when an item fails', async () => {
    const source = path.join(cwd, 'harness');
    await mkdir(path.join(source, 'context'), { recursive: true });
    await writeFile(path.join(source, 'context', 'AGENTS.md'), '<!-- ahm:tag:codex -->\nunclosed\n');
    await writeFile(path.join(cwd, 'ahm.config.json'), JSON.stringify({ source, targets: ['codex'] }));
    expect(await ahm('export', '--strategy', 'override', '--out', 'out2')).toBe(EXIT.exportFailed);
    expect(out()).toContain('failed');
  });

  it('should exit 1 on an invalid config or flag', async () => {
    expect(await ahm('export', '--target', 'vim')).toBe(EXIT.invalid);
    await writeFile(path.join(cwd, 'ahm.config.json'), JSON.stringify({ targets: ['nope'] }));
    expect(await ahm('export')).toBe(EXIT.invalid);
    expect(err()).toContain('targets[0]');
  });

  it('should exit 1 when the harness is invalid', async () => {
    await writeFile(path.join(cwd, 'ahm.config.json'), JSON.stringify({ source: 'missing', targets: ['codex'] }));
    expect(await ahm('export')).toBe(EXIT.invalid);
    expect(err()).toContain('harness source directory not found');
  });
});
