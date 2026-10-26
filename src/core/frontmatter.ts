import { parse } from 'yaml';
import { z } from 'zod';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown> | undefined;
  body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Splits a Markdown document into its YAML frontmatter and body. Throws on invalid YAML. */
export const parseFrontmatter = (source: string): ParsedMarkdown => {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) {
    return { frontmatter: undefined, body: source };
  }
  const data: unknown = parse(match[1]);
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return {
    frontmatter: (data ?? {}) as Record<string, unknown>,
    body: source.slice(match[0].length),
  };
};

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const skillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(SKILL_NAME_PATTERN, 'must be lowercase letters, numbers and single hyphens');

export const skillFrontmatterSchema = z.looseObject({
  name: skillNameSchema.optional(),
  description: z.string().min(1).max(1024),
});

export const agentFrontmatterSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.union([z.string(), z.array(z.string())]).optional(),
  model: z.string().optional(),
});

export const hookFileSchema = z.looseObject({
  hooks: z.record(z.string(), z.array(z.unknown())),
});

export const formatZodIssues = (error: z.ZodError): string =>
  error.issues
    .map(issue => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
