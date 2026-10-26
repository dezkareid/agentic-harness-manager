import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig } from '../src/config/load.js';
import { loadHarness } from '../src/core/loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tableLines = (markdown: string): string[] => markdown.split('\n').filter(line => line.startsWith('|'));

describe('given the bundled ahm-cli skill', () => {
  it('should load from the repo harness configured in ahm.config.json', async () => {
    const { config } = await loadConfig(root);
    const { harness } = await loadHarness(path.resolve(root, config.source));
    expect(harness.items.map(item => `${item.kind}:${item.name}`)).toEqual(['skill:ahm-cli']);
    expect(config.targets).toEqual(['claude-code']);
  });

  it('should keep its frontmatter portable', async () => {
    const { harness } = await loadHarness(root);
    const frontmatter = harness.items[0].frontmatter ?? {};
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'metadata', 'name']);
    expect(frontmatter.metadata).toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    ['export harness', 'sync skills to codex/antigravity', 'ahm', 'agentic harness'].forEach(phrase =>
      expect(String(frontmatter.description)).toContain(phrase),
    );
  });

  it('should copy the README target matrix verbatim', async () => {
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const matrix = readme.slice(readme.indexOf('## Target matrix'), readme.indexOf('## Troubleshooting'));
    const reference = await readFile(path.join(root, 'skills', 'ahm-cli', 'references', 'target-matrix.md'), 'utf8');
    expect(tableLines(reference)).toEqual(tableLines(matrix));
  });

  it('should copy the README config table', async () => {
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const config = readme.slice(readme.indexOf('## Configuration'), readme.indexOf('## Strategies'));
    const reference = await readFile(path.join(root, 'skills', 'ahm-cli', 'references', 'config-schema.md'), 'utf8');
    expect(tableLines(reference)).toEqual(tableLines(config));
  });

  it('should be published with the package', () => {
    expect(pkg.files).toContain('skills');
  });
});
