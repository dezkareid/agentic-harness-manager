import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, STARTER_CONFIG, writeStarterConfig } from './load.js';
import { ConfigError } from './schema.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'ahm-config-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const write = (name: string, content: string) => writeFile(path.join(cwd, name), content);

describe('given no config anywhere', () => {
  it('should fall back to defaults', async () => {
    const loaded = await loadConfig(cwd);
    expect(loaded.path).toBeUndefined();
    expect(loaded.config).toEqual({ source: './harness', outputDir: '.', targets: [], omit: [], overrides: {} });
  });
});

describe('given several config sources', () => {
  beforeEach(async () => {
    await write('ahm.config.json', '{ "source": "from-json" }');
    await write('ahm.config.yaml', 'source: from-yaml\n');
    await write('package.json', JSON.stringify({ name: 'x', ahm: { source: 'from-pkg' } }));
    await write('custom.yaml', 'source: from-flag\n');
  });

  it('should prefer --config', async () => {
    const loaded = await loadConfig(cwd, 'custom.yaml');
    expect(loaded.config.source).toBe('from-flag');
    expect(loaded.path).toBe(path.join(cwd, 'custom.yaml'));
  });

  it('should then prefer ahm.config.json', async () => {
    expect((await loadConfig(cwd)).config.source).toBe('from-json');
  });

  it('should then use ahm.config.yaml', async () => {
    await rm(path.join(cwd, 'ahm.config.json'));
    expect((await loadConfig(cwd)).config.source).toBe('from-yaml');
  });

  it('should finally use the "ahm" key in package.json', async () => {
    await rm(path.join(cwd, 'ahm.config.json'));
    await rm(path.join(cwd, 'ahm.config.yaml'));
    expect((await loadConfig(cwd)).config.source).toBe('from-pkg');
  });
});

describe('given an explicit --config that does not exist', () => {
  it('should fail with the resolved path', async () => {
    await expect(loadConfig(cwd, 'nope.json')).rejects.toThrow(`Config file not found: ${path.join(cwd, 'nope.json')}`);
  });
});

describe('given an invalid config', () => {
  it('should list the path of every offending key', async () => {
    await write(
      'ahm.config.json',
      JSON.stringify({ targets: ['codex', { id: 'vim' }], defaultStrategy: 'hardlink', overrides: { 'skill:*': { tags: [1] } }, extra: true }),
    );
    const error = await loadConfig(cwd).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain(`Invalid config in ${path.join(cwd, 'ahm.config.json')}`);
    expect(message).toContain('targets[1]');
    expect(message).toContain('defaultStrategy:');
    expect(message).toContain('overrides.skill:*.tags[0]:');
    expect(message).toMatch(/\(root\): Unrecognized key: "extra"/);
  });

  it('should report unparsable files', async () => {
    await write('ahm.config.yaml', 'source: [unclosed\n');
    await expect(loadConfig(cwd)).rejects.toThrow(/Cannot parse .*ahm\.config\.yaml/);
  });
});

describe('given ahm init', () => {
  it('should write a commented starter config that loads back', async () => {
    const file = await writeStarterConfig(cwd);
    expect(await readFile(file, 'utf8')).toBe(STARTER_CONFIG);
    expect((await loadConfig(cwd)).config.targets).toEqual(['claude-code']);
  });

  it('should refuse to overwrite without force', async () => {
    await write('ahm.config.json', '{}');
    await expect(writeStarterConfig(cwd)).rejects.toThrow('already exists (use --force to overwrite)');
    await writeStarterConfig(cwd, true);
    expect(await readFile(path.join(cwd, 'ahm.config.json'), 'utf8')).toBe(STARTER_CONFIG);
  });
});
