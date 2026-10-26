/**
 * Serializes a flat record of strings as TOML. JSON string escaping is a valid subset of
 * TOML basic strings, so values are quoted with JSON.stringify.
 */
export const toToml = (record: Record<string, string | undefined>): string =>
  Object.entries(record)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join('\n') + '\n';
