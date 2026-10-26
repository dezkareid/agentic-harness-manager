import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadHarness } from './loader.js';
import { HarnessLoadError } from './types.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const loadError = async (source: string): Promise<HarnessLoadError> => {
  const error = await loadHarness(source).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HarnessLoadError);
  return error as HarnessLoadError;
};

describe('given a valid harness', () => {
  const root = path.join(fixtures, 'valid');

  it('should load every kind of item in a stable order', async () => {
    const { harness, warnings } = await loadHarness(root);
    expect(harness.root).toBe(root);
    expect(harness.items.map(item => `${item.kind}:${item.name}`)).toEqual([
      'skill:code-review',
      'skill:release-notes',
      'context:AGENTS.md',
      'hook:format',
      'agent:reviewer',
    ]);
    expect(warnings).toEqual([]);
  });

  it('should treat skills as directories and preserve unknown frontmatter keys', async () => {
    const { harness } = await loadHarness(root);
    const skill = harness.items.find(item => item.name === 'code-review');
    expect(skill).toMatchObject({
      isDirectory: true,
      sourcePath: path.join(root, 'skills', 'code-review'),
      frontmatter: { name: 'code-review', license: 'MIT', metadata: { version: '1.0.0' } },
    });
    expect(skill?.body).toContain('# Code review');
  });

  it('should default the skill name to its directory', async () => {
    const { harness } = await loadHarness(root);
    expect(harness.items.find(item => item.name === 'release-notes')?.frontmatter).toMatchObject({
      name: 'release-notes',
    });
  });

  it('should parse agent frontmatter and hook JSON', async () => {
    const { harness } = await loadHarness(root);
    expect(harness.items.find(item => item.kind === 'agent')).toMatchObject({
      isDirectory: false,
      frontmatter: { name: 'reviewer', tools: 'Read, Grep', model: 'sonnet' },
    });
    expect(harness.items.find(item => item.kind === 'hook')?.content).toMatchObject({
      hooks: { PostToolUse: [expect.objectContaining({ matcher: 'Edit|Write' })] },
    });
  });
});

describe('given an invalid harness', () => {
  const root = path.join(fixtures, 'invalid');

  it('should report every invalid file with its path', async () => {
    const error = await loadError(root);
    const byFile = Object.fromEntries(
      error.issues.map(issue => [path.relative(root, issue.path), issue.message]),
    );
    expect(Object.keys(byFile).sort()).toEqual([
      'agents/no-frontmatter.md',
      'agents/no-name.md',
      'hooks/broken.json',
      'hooks/wrong-shape.json',
      'skills/Bad_Name/SKILL.md',
      'skills/no-description/SKILL.md',
      'skills/no-skill-file/SKILL.md',
    ]);
    expect(byFile['skills/no-skill-file/SKILL.md']).toBe('missing SKILL.md');
    expect(byFile['skills/Bad_Name/SKILL.md']).toMatch(/^name: /);
    expect(byFile['skills/no-description/SKILL.md']).toMatch(/^description: /);
    expect(byFile['hooks/broken.json']).toMatch(/^invalid JSON/);
    expect(byFile['hooks/wrong-shape.json']).toMatch(/^hooks\.PreToolUse: /);
    expect(byFile['agents/no-frontmatter.md']).toMatch(/^missing frontmatter/);
    expect(byFile['agents/no-name.md']).toMatch(/^name: /);
    expect(error.message).toContain(path.join(root, 'hooks', 'broken.json'));
  });

  it('should fail when the source directory does not exist', async () => {
    const error = await loadError(path.join(fixtures, 'missing'));
    expect(error.issues[0].message).toBe('harness source directory not found');
  });
});

describe('given an empty harness', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ahm-empty-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should warn that there are no items', async () => {
    const { harness, warnings } = await loadHarness(root);
    expect(harness.items).toEqual([]);
    expect(warnings).toEqual([`${root}: harness has no items`]);
  });

  it('should warn about empty kind and skill folders', async () => {
    await mkdir(path.join(root, 'hooks'));
    await mkdir(path.join(root, 'skills', 'placeholder'), { recursive: true });
    const { warnings } = await loadHarness(root);
    expect(warnings).toEqual([
      `${path.join(root, 'skills', 'placeholder')}: skill directory is empty`,
      `${path.join(root, 'hooks')}: directory is empty`,
      `${root}: harness has no items`,
    ]);
  });
});
