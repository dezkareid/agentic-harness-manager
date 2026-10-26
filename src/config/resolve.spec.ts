import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from './load.js';
import { matchesSelector, resolveConfig, resolveItemSettings } from './resolve.js';
import type { CliOptions } from './resolve.js';
import { parseConfig } from './schema.js';
import type { AhmConfigInput } from './schema.js';

const cwd = path.resolve('/work');
const loaded = (input: AhmConfigInput): LoadedConfig => ({ config: parseConfig(input, 'test'), baseDir: cwd });
const skill = { kind: 'skill' as const, name: 'internal-notes' };

const settingsFor = (input: AhmConfigInput, cli: CliOptions = {}, item = skill) => {
  const config = resolveConfig(loaded(input), cli, cwd);
  return resolveItemSettings(config, config.targets[0], item);
};

describe('given selectors', () => {
  it.each([
    ['skill:internal-*', true],
    ['skill:*', true],
    ['hook:*', false],
    ['internal-*', true],
    ['*-notes', true],
    ['internal-note?', true],
    ['other', false],
  ])('should match "%s" → %s', (selector, expected) => {
    expect(matchesSelector(selector, skill)).toBe(expected);
  });

  it('should treat an unknown prefix as part of a name glob', () => {
    expect(matchesSelector('AGENTS.md', { kind: 'context', name: 'AGENTS.md' })).toBe(true);
    expect(matchesSelector('foo:bar', { kind: 'skill', name: 'foo:bar' })).toBe(true);
  });
});

describe('given targets from config and CLI', () => {
  it('should use config targets, keeping per-target settings', () => {
    const config = resolveConfig(loaded({ targets: ['codex', { id: 'strands', strategy: 'symlink', outputDir: 'out' }] }), {}, cwd);
    expect(config.targets).toEqual([
      { id: 'codex', tags: [], omit: [] },
      { id: 'strands', strategy: 'symlink', outputDir: path.join(cwd, 'out'), tags: [], omit: [] },
    ]);
  });

  it('should let --target replace the list while reusing matching per-target settings', () => {
    const config = resolveConfig(loaded({ targets: [{ id: 'codex', strategy: 'copy' }] }), { targets: ['antigravity', 'codex'] }, cwd);
    expect(config.targets.map(target => [target.id, target.strategy])).toEqual([
      ['antigravity', undefined],
      ['codex', 'copy'],
    ]);
  });

  it('should resolve paths against the config dir and CLI paths against cwd', () => {
    const config = resolveConfig({ ...loaded({ source: 'h' }), baseDir: path.join(cwd, 'cfg') }, { outputDir: 'dist' }, cwd);
    expect(config.source).toBe(path.join(cwd, 'cfg', 'h'));
    expect(config.outputDir).toBe(path.join(cwd, 'dist'));
  });
});

describe('given strategy at every level', () => {
  const full: AhmConfigInput = {
    targets: [{ id: 'codex', strategy: 'copy' }],
    defaultStrategy: 'copy',
    overrides: { 'skill:*': { strategy: 'override' } },
  };

  it('should prefer the CLI flag', () => {
    expect(settingsFor(full, { strategy: 'symlink' }).strategy).toBe('symlink');
  });

  it('should then prefer the per-target config', () => {
    expect(settingsFor({ ...full, defaultStrategy: 'symlink' }).strategy).toBe('copy');
  });

  it('should then prefer the per-item override', () => {
    expect(settingsFor({ ...full, targets: ['codex'] }).strategy).toBe('override');
  });

  it('should then use the global default', () => {
    expect(settingsFor({ targets: ['codex'], defaultStrategy: 'copy' }).strategy).toBe('copy');
  });

  it.each([
    ['claude-code', 'symlink'],
    ['codex', 'symlink'],
    ['antigravity', 'copy'],
    ['strands', 'copy'],
  ] as const)('should fall back to the %s default (%s)', (id, strategy) => {
    expect(settingsFor({ targets: [id] }).strategy).toBe(strategy);
  });

  it('should let the last matching override win', () => {
    const settings = settingsFor({
      targets: ['codex'],
      overrides: { '*': { strategy: 'copy' }, 'skill:internal-*': { strategy: 'override' } },
    });
    expect(settings.strategy).toBe('override');
  });
});

describe('given output directories at every level', () => {
  const full: AhmConfigInput = {
    outputDir: 'global',
    targets: [{ id: 'codex', outputDir: 'target' }],
    overrides: { 'skill:*': { outputDir: 'item' } },
  };

  it('should follow CLI > target > item > global', () => {
    expect(settingsFor(full, { outputDir: 'cli' }).outputDir).toBe(path.join(cwd, 'cli'));
    expect(settingsFor(full).outputDir).toBe(path.join(cwd, 'target'));
    expect(settingsFor({ ...full, targets: ['codex'] }).outputDir).toBe(path.join(cwd, 'item'));
    expect(settingsFor({ outputDir: 'global', targets: ['codex'] }).outputDir).toBe(path.join(cwd, 'global'));
  });
});

describe('given tags and omit selectors', () => {
  it('should accumulate tags with the target id first', () => {
    const settings = settingsFor(
      { targets: [{ id: 'codex', tags: ['team'] }], overrides: { 'skill:*': { tags: ['internal', 'team'] } } },
      { tags: ['ci'] },
    );
    expect(settings.tags).toEqual(['codex', 'ci', 'team', 'internal']);
  });

  it('should omit items matched at any level', () => {
    expect(settingsFor({ targets: ['codex'], omit: ['skill:internal-*'] }).omitted).toBe(true);
    expect(settingsFor({ targets: [{ id: 'codex', omit: ['internal-*'] }] }).omitted).toBe(true);
    expect(settingsFor({ targets: ['codex'] }, { omit: ['skill:*'] }).omitted).toBe(true);
    expect(settingsFor({ targets: ['codex'], omit: ['hook:*'] }).omitted).toBe(false);
  });
});
