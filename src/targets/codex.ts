import path from 'node:path';
import { TARGET_DEFAULT_STRATEGY } from '../config/resolve.js';
import { writeFlattenedContext } from './context.js';
import { hooksOf, mergeHooks, mergeHooksIntoJson } from './hooks.js';
import type { HooksByEvent } from './hooks.js';
import { applyStrategy, bodyOf, writeText } from './shared.js';
import { toToml } from './toml.js';
import type { Target, TargetOutput } from './types.js';

export const CODEX_CONTEXT_LIMIT = 32 * 1024;

export const CODEX_HOOK_EVENTS = new Set([
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
]);

const CODEX_HANDLER_TYPES = new Set(['command', 'mcp_tool']);

interface MatcherGroup {
  hooks?: Array<{ type?: string }>;
  [key: string]: unknown;
}

/** Keeps the events and handler types Codex supports; returns what was dropped. */
export const filterCodexHooks = (hooks: HooksByEvent): { kept: HooksByEvent; dropped: string[] } => {
  const kept: HooksByEvent = {};
  const dropped: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!CODEX_HOOK_EVENTS.has(event)) {
      dropped.push(`event ${event} not supported by codex`);
      continue;
    }
    const filtered = (groups as MatcherGroup[]).flatMap((group) => {
      const handlers = (group.hooks ?? []).filter((handler) => {
        const supported = CODEX_HANDLER_TYPES.has(handler.type ?? '');
        if (!supported) {
          dropped.push(`${event}: handler type ${handler.type ?? '(none)'} not supported by codex`);
        }
        return supported;
      });
      return handlers.length > 0 ? [{ ...group, hooks: handlers }] : [];
    });
    if (filtered.length > 0) {
      kept[event] = filtered;
    }
  }
  return { kept, dropped };
};

/**
 * Codex CLI: skills in `.agents/skills/<name>/` (directory symlinks only; Codex never follows
 * file symlinks), a flattened `AGENTS.md`, hooks in `.codex/hooks.json` (Claude shape, filtered)
 * and subagents as `.codex/agents/<name>.toml`.
 */
export const codexTarget: Target = {
  id: 'codex',
  defaultStrategy: TARGET_DEFAULT_STRATEGY.codex,
  supports: () => true,
  layout: (item) => {
    switch (item.kind) {
      case 'skill':
        return { destPath: path.join('.agents', 'skills', item.name), mode: 'dir' };
      case 'context':
        return { destPath: item.name, mode: 'file' };
      case 'hook':
        return { destPath: path.join('.codex', 'hooks.json'), mode: 'merge' };
      case 'agent':
        return { destPath: path.join('.codex', 'agents', `${item.name}.toml`), mode: 'file' };
    }
  },
  transform: async (item, dest, ctx) => {
    switch (item.kind) {
      case 'context':
        return writeFlattenedContext(item, dest, ctx, CODEX_CONTEXT_LIMIT);
      case 'agent': {
        const frontmatter = item.frontmatter ?? {};
        return writeText(
          dest,
          toToml({
            name: item.name,
            description: String(frontmatter.description),
            model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
            developer_instructions: bodyOf(item, ctx.settings),
          }),
          ctx,
        );
      }
      default:
        return applyStrategy(item, dest, ctx);
    }
  },
  postProcess: async (ctx) => {
    if (ctx.merged.length === 0) {
      return [];
    }
    const file = path.join(ctx.outputDir, '.codex', 'hooks.json');
    const outputs: TargetOutput[] = [];
    const kept = ctx.merged.map(({ item }) => {
      const result = filterCodexHooks(hooksOf(item));
      outputs.push(...result.dropped.map(reason => ({ dest: file, kind: 'hook' as const, name: item.name, action: 'skipped' as const, reason })));
      return result.kept;
    });
    const hooks = mergeHooks(...kept);
    if (Object.keys(hooks).length === 0) {
      return outputs;
    }
    return [await mergeHooksIntoJson(file, hooks, ctx.strategy), ...outputs];
  },
};
