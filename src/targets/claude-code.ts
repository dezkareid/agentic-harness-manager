import path from 'node:path';
import { TARGET_DEFAULT_STRATEGY } from '../config/resolve.js';
import { writeGenerated } from '../strategies/index.js';
import { hooksOf, mergeHooks, mergeHooksIntoJson } from './hooks.js';
import type { Target } from './types.js';

export const CANONICAL_CONTEXT = 'AGENTS.md';
export const CLAUDE_SHIM = `@${CANONICAL_CONTEXT}\n`;

/**
 * Claude Code: skills in `.claude/skills/<name>/`, agents in `.claude/agents/<name>.md`,
 * hooks merged into `.claude/settings.json`. Claude reads AGENTS.md only when there is no
 * CLAUDE.md, so AGENTS.md is exported next to a `CLAUDE.md` that imports it. Legacy
 * `.claude/commands/` is never written: skills supersede commands.
 */
export const claudeCodeTarget: Target = {
  id: 'claude-code',
  defaultStrategy: TARGET_DEFAULT_STRATEGY['claude-code'],
  supports: () => true,
  layout: (item, ctx) => {
    switch (item.kind) {
      case 'skill':
        return { destPath: path.join('.claude', 'skills', item.name), mode: 'dir' };
      case 'agent':
        return { destPath: path.join('.claude', 'agents', `${item.name}.md`), mode: 'file' };
      case 'hook':
        return { destPath: path.join('.claude', 'settings.json'), mode: 'merge' };
      case 'context':
        if (item.name === CANONICAL_CONTEXT && ctx.settings.strategy === 'override') {
          return { destPath: 'CLAUDE.md', mode: 'file' };
        }
        return { destPath: item.name, mode: 'file' };
    }
  },
  postProcess: async (ctx) => {
    const outputs = [];
    const needsShim = ctx.exported.some(
      ({ item, settings }) => item.kind === 'context' && item.name === CANONICAL_CONTEXT && settings.strategy !== 'override',
    );
    if (needsShim) {
      const shim = path.join(ctx.outputDir, 'CLAUDE.md');
      outputs.push({ dest: shim, kind: 'context' as const, name: 'CLAUDE.md', ...(await writeGenerated(shim, CLAUDE_SHIM, ctx.strategy)) });
    }
    if (ctx.merged.length > 0) {
      const settings = path.join(ctx.outputDir, '.claude', 'settings.json');
      outputs.push(await mergeHooksIntoJson(settings, mergeHooks(...ctx.merged.map(({ item }) => hooksOf(item))), ctx.strategy));
    }
    return outputs;
  },
};
