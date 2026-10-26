import type { TargetId } from '../config/schema.js';
import { antigravityTarget } from './antigravity.js';
import { claudeCodeTarget } from './claude-code.js';
import { codexTarget } from './codex.js';
import { strandsTarget } from './strands.js';
import type { Target } from './types.js';

export const TARGETS: Record<TargetId, Target> = {
  'claude-code': claudeCodeTarget,
  'codex': codexTarget,
  'antigravity': antigravityTarget,
  'strands': strandsTarget,
};

export type { ExportedItem, Layout, LayoutMode, PostProcessContext, Target, TargetContext, TargetOutput } from './types.js';
