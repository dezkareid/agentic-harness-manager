import { describe, expect, it } from 'vitest';
import { renderTags } from './render.js';

const doc = (...lines: string[]) => lines.join('\n');

describe('given tag blocks', () => {
  const source = doc(
    '# Title',
    '<!-- ahm:tag:codex,antigravity -->',
    'Codex or Antigravity only.',
    '<!-- /ahm:tag -->',
    '<!-- ahm:tag:claude-code -->',
    'Claude only.',
    '<!-- /ahm:tag -->',
    'Shared.',
  );

  it('should keep blocks whose tags match and drop the markers', () => {
    expect(renderTags(source, ['codex'])).toBe(doc('# Title', 'Codex or Antigravity only.', 'Shared.'));
  });

  it('should remove blocks whose tags do not match', () => {
    expect(renderTags(source, ['strands'])).toBe(doc('# Title', 'Shared.'));
  });

  it('should tolerate extra whitespace inside markers', () => {
    expect(renderTags(doc('<!--   ahm:tag: codex , x   -->', 'kept', '  <!-- /ahm:tag -->'), ['codex'])).toBe('kept');
  });
});

describe('given omit blocks', () => {
  it('should always remove them', () => {
    expect(renderTags(doc('a', '<!-- ahm:omit -->', 'secret', '<!-- /ahm:omit -->', 'b'), ['codex'])).toBe(doc('a', 'b'));
  });
});

describe('given single-line only markers', () => {
  it('should keep the rest of the line for matching tags', () => {
    expect(renderTags('  <!-- ahm:only:codex --> - use `.codex`', ['codex'])).toBe('  - use `.codex`');
  });

  it('should drop the whole line otherwise', () => {
    expect(renderTags(doc('a', '<!-- ahm:only:codex,strands --> x', 'b'), ['claude-code'])).toBe(doc('a', 'b'));
  });
});

describe('given content without ahm markers', () => {
  it('should leave unknown markers and other comments untouched', () => {
    const source = doc('<!-- ahm:something -->', '<!-- regular comment -->', 'text <!-- ahm:tag:x --> inline', '');
    expect(renderTags(source, ['x'])).toBe(source);
  });

  it('should render JSON text the same way', () => {
    const json = doc('{', '<!-- ahm:tag:codex -->', '  "a": 1', '<!-- /ahm:tag -->', '}');
    expect(JSON.parse(renderTags(json, ['claude-code']))).toEqual({});
  });
});

describe('given malformed blocks', () => {
  it.each([
    [doc('<!-- ahm:tag:a -->', '<!-- ahm:omit -->', '<!-- /ahm:omit -->', '<!-- /ahm:tag -->'), 'line 2: nested ahm block inside the block opened on line 1'],
    [doc('<!-- ahm:tag:a -->', 'x'), 'line 1: ahm:tag block is never closed'],
    [doc('x', '<!-- /ahm:tag -->'), 'line 2: closing /ahm:tag without an opening block'],
    [doc('<!-- ahm:omit -->', '<!-- /ahm:tag -->'), 'line 2: /ahm:tag closes the ahm:omit block opened on line 1'],
    [doc('<!-- ahm:tag: -->', '<!-- /ahm:tag -->'), 'line 1: ahm:tag block needs at least one tag'],
  ])('should reject %j', (source, message) => {
    expect(() => renderTags(source, ['a'])).toThrow(message);
  });
});

describe('given CRLF line endings', () => {
  it('should render blocks and only markers while keeping CRLF', () => {
    const source = ['a', '<!-- ahm:tag:x -->', 'kept', '<!-- /ahm:tag -->', '<!-- ahm:only:y --> dropped', '<!-- ahm:only:x --> only', 'b', ''].join('\r\n');
    expect(renderTags(source, ['x'])).toBe(['a', 'kept', 'only', 'b', ''].join('\r\n'));
  });
});
