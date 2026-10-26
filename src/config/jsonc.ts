/** Returns the index of the closing quote of the string starting at `start`. */
const endOfString = (source: string, start: number): number => {
  let i = start + 1;
  while (i < source.length && source[i] !== '"') {
    i += source[i] === '\\' ? 2 : 1;
  }
  return i;
};

/** Returns the index just past the comment starting at `start`, or `start` if there is none. */
const endOfComment = (source: string, start: number): number => {
  if (source.startsWith('//', start)) {
    const newline = source.indexOf('\n', start);
    return newline === -1 ? source.length : newline;
  }
  if (source.startsWith('/*', start)) {
    const close = source.indexOf('*/', start + 2);
    return close === -1 ? source.length : close + 2;
  }
  return start;
};

/** Removes `//` and `/* *\/` comments outside of strings so commented JSON files can be parsed. */
export const stripJsonComments = (source: string): string => {
  let output = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] === '"') {
      const end = endOfString(source, i);
      output += source.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const end = endOfComment(source, i);
    if (end > i) {
      i = end;
      continue;
    }
    output += source[i];
    i++;
  }
  return output;
};

export const parseJsonc = (source: string): unknown => JSON.parse(stripJsonComments(source));
