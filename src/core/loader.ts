import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  agentFrontmatterSchema,
  formatZodIssues,
  hookFileSchema,
  parseFrontmatter,
  skillFrontmatterSchema,
} from './frontmatter.js';
import { HarnessLoadError } from './types.js';
import type { HarnessIssue, HarnessItem, LoadResult } from './types.js';

export const DEFAULT_SOURCE = './harness';

export const SOURCE_DIRS = {
  skill: 'skills',
  context: 'context',
  hook: 'hooks',
  agent: 'agents',
} as const;

interface LoadContext {
  items: HarnessItem[];
  issues: HarnessIssue[];
  warnings: string[];
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const byName = (a: Dirent, b: Dirent): number => a.name.localeCompare(b.name);

/** Lists a kind directory. Missing directories are fine; empty ones produce a warning. */
const listKindDir = async (dir: string, ctx: LoadContext): Promise<Dirent[]> => {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const visible = entries.filter(entry => !entry.name.startsWith('.')).sort(byName);
  if (visible.length === 0) {
    ctx.warnings.push(`${dir}: directory is empty`);
  }
  return visible;
};

const loadSkills = async (root: string, ctx: LoadContext): Promise<void> => {
  const dir = path.join(root, SOURCE_DIRS.skill);
  for (const entry of await listKindDir(dir, ctx)) {
    const skillDir = path.join(dir, entry.name);
    if (!entry.isDirectory()) {
      ctx.warnings.push(`${skillDir}: ignored, skills must be directories`);
      continue;
    }
    const files = (await readdir(skillDir)).filter(name => !name.startsWith('.'));
    if (files.length === 0) {
      ctx.warnings.push(`${skillDir}: skill directory is empty`);
      continue;
    }
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!files.includes('SKILL.md')) {
      ctx.issues.push({ path: skillFile, message: 'missing SKILL.md' });
      continue;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(await readFile(skillFile, 'utf8'));
    }
    catch (error) {
      ctx.issues.push({ path: skillFile, message: `invalid frontmatter: ${errorMessage(error)}` });
      continue;
    }
    if (!parsed.frontmatter) {
      ctx.issues.push({ path: skillFile, message: 'missing frontmatter (name, description)' });
      continue;
    }
    const result = skillFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) {
      ctx.issues.push({ path: skillFile, message: formatZodIssues(result.error) });
      continue;
    }
    const name = result.data.name ?? entry.name;
    if (name !== entry.name) {
      ctx.issues.push({ path: skillFile, message: `name "${name}" must match its directory "${entry.name}"` });
      continue;
    }
    ctx.items.push({
      kind: 'skill',
      name,
      sourcePath: skillDir,
      isDirectory: true,
      frontmatter: { ...result.data, name },
      body: parsed.body,
    });
  }
};

const loadContext = async (root: string, ctx: LoadContext): Promise<void> => {
  const dir = path.join(root, SOURCE_DIRS.context);
  for (const entry of await listKindDir(dir, ctx)) {
    const file = path.join(dir, entry.name);
    if (!entry.isFile() || path.extname(entry.name) !== '.md') {
      ctx.warnings.push(`${file}: ignored, context files must be .md`);
      continue;
    }
    ctx.items.push({ kind: 'context', name: entry.name, sourcePath: file, isDirectory: false });
  }
};

const loadHooks = async (root: string, ctx: LoadContext): Promise<void> => {
  const dir = path.join(root, SOURCE_DIRS.hook);
  for (const entry of await listKindDir(dir, ctx)) {
    const file = path.join(dir, entry.name);
    if (!entry.isFile() || path.extname(entry.name) !== '.json') {
      ctx.warnings.push(`${file}: ignored, hook files must be .json`);
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    }
    catch (error) {
      ctx.issues.push({ path: file, message: `invalid JSON: ${errorMessage(error)}` });
      continue;
    }
    const result = hookFileSchema.safeParse(data);
    if (!result.success) {
      ctx.issues.push({ path: file, message: formatZodIssues(result.error) });
      continue;
    }
    ctx.items.push({
      kind: 'hook',
      name: path.basename(entry.name, '.json'),
      sourcePath: file,
      isDirectory: false,
      content: result.data,
    });
  }
};

const loadAgents = async (root: string, ctx: LoadContext): Promise<void> => {
  const dir = path.join(root, SOURCE_DIRS.agent);
  for (const entry of await listKindDir(dir, ctx)) {
    const file = path.join(dir, entry.name);
    if (!entry.isFile() || path.extname(entry.name) !== '.md') {
      ctx.warnings.push(`${file}: ignored, agent files must be .md`);
      continue;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(await readFile(file, 'utf8'));
    }
    catch (error) {
      ctx.issues.push({ path: file, message: `invalid frontmatter: ${errorMessage(error)}` });
      continue;
    }
    if (!parsed.frontmatter) {
      ctx.issues.push({ path: file, message: 'missing frontmatter (name, description)' });
      continue;
    }
    const result = agentFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) {
      ctx.issues.push({ path: file, message: formatZodIssues(result.error) });
      continue;
    }
    ctx.items.push({
      kind: 'agent',
      name: result.data.name,
      sourcePath: file,
      isDirectory: false,
      frontmatter: result.data,
      body: parsed.body,
    });
  }
};

/**
 * Reads a harness source folder into memory. Pure: never writes to disk.
 * Throws a HarnessLoadError listing every invalid file at once.
 */
export const loadHarness = async (source: string = DEFAULT_SOURCE): Promise<LoadResult> => {
  const root = path.resolve(source);
  const rootStat = await stat(root).catch(() => undefined);
  if (!rootStat?.isDirectory()) {
    throw new HarnessLoadError([{ path: root, message: 'harness source directory not found' }]);
  }

  const ctx: LoadContext = { items: [], issues: [], warnings: [] };
  await loadSkills(root, ctx);
  await loadContext(root, ctx);
  await loadHooks(root, ctx);
  await loadAgents(root, ctx);

  if (ctx.issues.length > 0) {
    throw new HarnessLoadError(ctx.issues);
  }
  if (ctx.items.length === 0) {
    ctx.warnings.push(`${root}: harness has no items`);
  }
  return { harness: { root, items: ctx.items }, warnings: ctx.warnings };
};
