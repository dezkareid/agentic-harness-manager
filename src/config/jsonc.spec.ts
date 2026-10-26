import { describe, expect, it } from 'vitest';
import { parseJsonc } from './jsonc.js';

describe('given JSON with comments', () => {
  it('should ignore line and block comments', () => {
    expect(parseJsonc('{\n  // line\n  "a": 1, /* block */ "b": 2\n}')).toEqual({ a: 1, b: 2 });
  });

  it('should keep comment-like text inside strings', () => {
    expect(parseJsonc('{ "url": "https://x.dev/*a*/", "q": "say \\"//hi\\"" }')).toEqual({
      url: 'https://x.dev/*a*/',
      q: 'say "//hi"',
    });
  });
});
