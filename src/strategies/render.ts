export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

const OPEN_MARKER = /^\s*<!--\s*ahm:(tag:([^>]*?)|omit)\s*-->\s*$/;
const CLOSE_MARKER = /^\s*<!--\s*\/ahm:(tag|omit)\s*-->\s*$/;
const ONLY_MARKER = /^(\s*)<!--\s*ahm:only:([^>]*?)\s*-->[ \t]?(.*)$/;

interface OpenBlock {
  type: 'tag' | 'omit';
  keep: boolean;
  line: number;
}

const parseTags = (list: string): string[] =>
  list.split(',').map(tag => tag.trim()).filter(Boolean);

const matches = (list: string, active: ReadonlySet<string>): boolean =>
  parseTags(list).some(tag => active.has(tag));

/**
 * Renders tag blocks for the active tags. Block markers must sit on their own line:
 * - `<!-- ahm:tag:a,b -->` … `<!-- /ahm:tag -->` kept only when a tag is active
 * - `<!-- ahm:omit -->` … `<!-- /ahm:omit -->` always removed
 * - `<!-- ahm:only:a,b --> text` keeps `text` only when a tag is active
 * Nested or unbalanced blocks throw a RenderError; unknown markers are left untouched.
 */
const openBlock = (
  opening: RegExpExecArray,
  open: OpenBlock | undefined,
  lineNumber: number,
  active: ReadonlySet<string>,
): OpenBlock => {
  if (open) {
    throw new RenderError(`line ${lineNumber}: nested ahm block inside the block opened on line ${open.line}`);
  }
  const type = opening[1] === 'omit' ? 'omit' : 'tag';
  if (type === 'tag' && parseTags(opening[2]).length === 0) {
    throw new RenderError(`line ${lineNumber}: ahm:tag block needs at least one tag`);
  }
  return { type, keep: type === 'tag' && matches(opening[2], active), line: lineNumber };
};

const closeBlock = (closing: RegExpExecArray, open: OpenBlock | undefined, lineNumber: number): undefined => {
  if (!open) {
    throw new RenderError(`line ${lineNumber}: closing /ahm:${closing[1]} without an opening block`);
  }
  if (closing[1] !== open.type) {
    throw new RenderError(`line ${lineNumber}: /ahm:${closing[1]} closes the ahm:${open.type} block opened on line ${open.line}`);
  }
  return undefined;
};

/** Returns the line to emit outside of blocks, or undefined to drop it. */
const renderLine = (line: string, active: ReadonlySet<string>): string | undefined => {
  const only = ONLY_MARKER.exec(line);
  if (!only) {
    return line;
  }
  return matches(only[2], active) ? `${only[1]}${only[3]}` : undefined;
};

export const renderTags = (source: string, tags: readonly string[]): string => {
  const active = new Set(tags);
  const output: string[] = [];
  let open: OpenBlock | undefined;

  source.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    const opening = OPEN_MARKER.exec(line);
    const closing = opening ? null : CLOSE_MARKER.exec(line);
    if (opening) {
      open = openBlock(opening, open, lineNumber, active);
    }
    else if (closing) {
      open = closeBlock(closing, open, lineNumber);
    }
    else if (open) {
      if (open.keep) {
        output.push(line);
      }
    }
    else {
      const rendered = renderLine(line, active);
      if (rendered !== undefined) {
        output.push(rendered);
      }
    }
  });

  if (open) {
    throw new RenderError(`line ${open.line}: ahm:${open.type} block is never closed`);
  }
  return output.join('\n');
};

/** Files the override strategy renders; everything else is copied as-is. */
export const isRenderable = (file: string): boolean => /\.(md|markdown|json)$/i.test(file);
