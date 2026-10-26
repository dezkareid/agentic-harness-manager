import path from 'node:path';
import type { ExportEntry } from '../export/run.js';

const COLUMNS = ['target', 'kind', 'name', 'strategy', 'action', 'destination', 'reason'] as const;

/** Relative to cwd when inside it, absolute otherwise. */
const displayPath = (dest: string, cwd: string): string => {
  const relative = path.relative(cwd, dest);
  return relative === '' ? '.' : relative.startsWith('..') || path.isAbsolute(relative) ? dest : relative;
};

const cells = (entry: ExportEntry, cwd: string): string[] => [
  entry.target,
  entry.kind ?? '-',
  entry.name ?? '-',
  entry.strategy ?? '-',
  entry.action,
  entry.dest ? displayPath(entry.dest, cwd) : '-',
  entry.reason ?? '',
];

/** Renders entries as an aligned plain-text table (no colors, safe to pipe). */
export const formatTable = (entries: ExportEntry[], cwd: string): string => {
  const rows = [COLUMNS.map(column => column.toUpperCase()), ...entries.map(entry => cells(entry, cwd))];
  const widths = COLUMNS.map((_, index) => Math.max(...rows.map(row => row[index].length)));
  return rows.map(row => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()).join('\n') + '\n';
};

export const formatJson = (entries: ExportEntry[]): string => `${JSON.stringify(entries, null, 2)}\n`;

/** One-line summary such as `5 written, 2 shared, 1 skipped, 0 failed`. */
export const summarize = (entries: ExportEntry[]): string => {
  const count = (predicate: (entry: ExportEntry) => boolean) => entries.filter(predicate).length;
  const written = count(entry => ['linked', 'copied', 'rendered', 'merged'].includes(entry.action));
  return `${written} written, ${count(entry => entry.action === 'shared')} shared, ${count(entry => entry.action === 'skipped')} skipped, ${count(entry => entry.action === 'failed')} failed`;
};
