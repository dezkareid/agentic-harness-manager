import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'dist', 'index.js');
const rollup = createRequire(import.meta.url).resolve('rollup/dist/bin/rollup');

describe('given the built binary', () => {
  beforeAll(async () => {
    await exec(process.execPath, [rollup, '-c'], { cwd: root });
  }, 60_000);

  it('should print the package version', async () => {
    const { stdout } = await exec(process.execPath, [bin, '--version']);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('should list the commands in --help', async () => {
    const { stdout } = await exec(process.execPath, [bin, '--help']);
    expect(stdout).toMatch(/export \[options\]/);
    expect(stdout).toMatch(/list \[options\]/);
    expect(stdout).toMatch(/init \[options\]/);
  });

  it('should exit 1 on an unknown target', async () => {
    await expect(exec(process.execPath, [bin, 'list', '--target', 'vim'])).rejects.toMatchObject({ code: 1 });
  });
});
