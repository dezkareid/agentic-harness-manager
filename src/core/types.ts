export const HARNESS_KINDS = ['skill', 'context', 'hook', 'agent'] as const;

export type HarnessKind = (typeof HARNESS_KINDS)[number];

export interface HarnessItem {
  kind: HarnessKind;
  name: string;
  /** Absolute path to the item: the skill directory, or the context/hook/agent file. */
  sourcePath: string;
  isDirectory: boolean;
  /** Parsed YAML frontmatter for skills and agents. */
  frontmatter?: Record<string, unknown>;
  /** Markdown body after the frontmatter for skills and agents. */
  body?: string;
  /** Parsed JSON for hooks. */
  content?: unknown;
}

export interface Harness {
  root: string;
  items: HarnessItem[];
}

export interface LoadResult {
  harness: Harness;
  warnings: string[];
}

export interface HarnessIssue {
  path: string;
  message: string;
}

export class HarnessLoadError extends Error {
  readonly issues: HarnessIssue[];

  constructor(issues: HarnessIssue[]) {
    super(`Invalid harness:\n${issues.map(issue => `  ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'HarnessLoadError';
    this.issues = issues;
  }
}
