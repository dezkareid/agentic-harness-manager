import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STARTER_CONFIG } from './config/load.js';
import { createProgram } from './program.js';

describe('given the ahm program', () => {
  it('should be named ahm', () => {
    expect(createProgram().name()).toBe('ahm');
  });

  it('should expose the package version', () => {
    expect(createProgram().version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('given ahm init', () => {
  it('should write the starter config into the working directory', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'ahm-init-'));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    try {
      await createProgram({ cwd, logger }).parseAsync(['init'], { from: 'user' });
      expect(await readFile(path.join(cwd, 'ahm.config.json'), 'utf8')).toBe(STARTER_CONFIG);
      expect(logger.info).toHaveBeenCalledWith(`Created ${path.join(cwd, 'ahm.config.json')}`);
    }
    finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
