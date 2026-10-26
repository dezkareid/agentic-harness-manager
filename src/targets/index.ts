import type { TargetId } from '../config/schema.js';
import { claudeCodeTarget } from './claude-code.js';
import type { Target } from './types.js';

export const TARGETS: Partial<Record<TargetId, Target>> = {
  'claude-code': claudeCodeTarget,
};

export type { Layout, LayoutMode, PostProcessContext, Target, TargetContext, TargetOutput } from './types.js';
