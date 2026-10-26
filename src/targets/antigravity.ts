import path from 'node:path';
import { TARGET_DEFAULT_STRATEGY } from '../config/resolve.js';
import { writeFlattenedContext } from './context.js';
import { hooksOf, updateJsonFile } from './hooks.js';
import type { HooksByEvent } from './hooks.js';
import { applyStrategy } from './shared.js';
import type { Target, TargetOutput } from './types.js';

export const ANTIGRAVITY_HOOK_EVENTS = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']);

interface MatcherGroup {
  matcher?: string;
  hooks?: Record<string, unknown>[];
}

/**
 * Converts Claude-shaped hooks (event → matcher groups → handlers) into Antigravity's
 * event → handlers map, copying each group's matcher onto its handlers.
 */
export const toAntigravityHooks = (hooks: HooksByEvent): { events: Record<string, unknown[]>; dropped: string[] } => {
  const events: Record<string, unknown[]> = {};
  const dropped: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!ANTIGRAVITY_HOOK_EVENTS.has(event)) {
      dropped.push(`event ${event} not supported by antigravity`);
      continue;
    }
    events[event] = (groups as MatcherGroup[]).flatMap(group =>
      (group.hooks ?? []).map(handler => (group.matcher ? { matcher: group.matcher, ...handler } : handler)),
    );
  }
  return { events, dropped };
};

/**
 * Antigravity: skills copied to `.agents/skills/<name>/` (shared with Codex when both write
 * there), a flattened `AGENTS.md`, hooks in `.agents/hooks.json` keyed by hook name, and
 * subagents in `.agents/agents/<name>.md`. Deprecated `.agents/workflows/` is never written.
 */
export const antigravityTarget: Target = {
  id: 'antigravity',
  defaultStrategy: TARGET_DEFAULT_STRATEGY.antigravity,
  supports: () => true,
  layout: (item) => {
    switch (item.kind) {
      case 'skill':
        return { destPath: path.join('.agents', 'skills', item.name), mode: 'dir' };
      case 'context':
        return { destPath: item.name, mode: 'file' };
      case 'hook':
        return { destPath: path.join('.agents', 'hooks.json'), mode: 'merge' };
      case 'agent':
        return { destPath: path.join('.agents', 'agents', `${item.name}.md`), mode: 'file' };
    }
  },
  transform: async (item, dest, ctx) => {
    if (item.kind === 'context') {
      return writeFlattenedContext(item, dest, ctx, Number.POSITIVE_INFINITY);
    }
    if (item.kind === 'agent' && item.frontmatter?.tools !== undefined) {
      ctx.strategy.warn(`${dest}: tools are passed through as-is; Antigravity tool ids differ from Claude Code's`);
    }
    return applyStrategy(item, dest, ctx);
  },
  postProcess: async (ctx) => {
    if (ctx.merged.length === 0) {
      return [];
    }
    const file = path.join(ctx.outputDir, '.agents', 'hooks.json');
    const outputs: TargetOutput[] = [];
    const generated: Record<string, Record<string, unknown[]>> = {};
    for (const { item } of ctx.merged) {
      const { events, dropped } = toAntigravityHooks(hooksOf(item));
      outputs.push(...dropped.map(reason => ({ dest: file, kind: 'hook' as const, name: item.name, action: 'skipped' as const, reason })));
      if (Object.keys(events).length > 0) {
        generated[item.name] = events;
      }
    }
    if (Object.keys(generated).length === 0) {
      return outputs;
    }
    return [await updateJsonFile(file, current => ({ ...current, ...generated }), ctx.strategy), ...outputs];
  },
};
