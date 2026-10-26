import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

const collect = (stream: PassThrough): string[] => {
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  return chunks;
};

describe('given a logger bound to custom streams', () => {
  it('should write info messages to stdout', () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const out = collect(stdout);
    createLogger(stdout, stderr).info('hello');
    expect(out.join('')).toBe('hello\n');
  });

  it('should write warnings and errors to stderr with a prefix', () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const err = collect(stderr);
    const log = createLogger(stdout, stderr);
    log.warn('careful');
    log.error('boom');
    expect(err.join('')).toBe('warn: careful\nerror: boom\n');
  });
});
