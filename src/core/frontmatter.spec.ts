import { describe, expect, it } from 'vitest';
import { parseFrontmatter, skillNameSchema } from './frontmatter.js';

describe('given a markdown document', () => {
  it('should split YAML frontmatter from the body', () => {
    const parsed = parseFrontmatter('---\nname: a\ndescription: b\n---\n\nBody\n');
    expect(parsed.frontmatter).toEqual({ name: 'a', description: 'b' });
    expect(parsed.body).toBe('\nBody\n');
  });

  it('should return no frontmatter when the document has none', () => {
    expect(parseFrontmatter('# Title\n')).toEqual({ frontmatter: undefined, body: '# Title\n' });
  });

  it('should treat an empty frontmatter block as an empty mapping', () => {
    expect(parseFrontmatter('---\n\n---\nBody').frontmatter).toEqual({});
  });

  it('should reject frontmatter that is not a mapping', () => {
    expect(() => parseFrontmatter('---\n- a\n- b\n---\n')).toThrow('YAML mapping');
  });
});

describe('given a skill name', () => {
  it.each(['a', 'code-review', 'v2-tools', 'x'.repeat(64)])('should accept "%s"', (name) => {
    expect(skillNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['', 'Code', 'snake_case', '-lead', 'trail-', 'double--hyphen', 'x'.repeat(65)])(
    'should reject "%s"',
    (name) => {
      expect(skillNameSchema.safeParse(name).success).toBe(false);
    },
  );
});
