import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

const streams = () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: string[] = [];
  const err: string[] = [];
  stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
  stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
  return { stdout, stderr, out: () => out.join(''), err: () => err.join('') };
};

describe('given a logger bound to custom streams', () => {
  it('should write info to stdout and warnings/errors to stderr with a prefix', () => {
    const s = streams();
    const log = createLogger(s.stdout, s.stderr, { color: false });
    log.info('hello');
    log.warn('careful');
    log.error('boom');
    expect(s.out()).toBe('hello\n');
    expect(s.err()).toBe('warn: careful\nerror: boom\n');
  });

  it('should hide info with the quiet level but keep printed output', () => {
    const s = streams();
    const log = createLogger(s.stdout, s.stderr, { color: false, level: 'quiet' });
    log.info('progress');
    log.print('{"a":1}\n');
    log.warn('still shown');
    expect(s.out()).toBe('{"a":1}\n');
    expect(s.err()).toBe('warn: still shown\n');
  });

  it('should only show debug messages when verbose', () => {
    const s = streams();
    const log = createLogger(s.stdout, s.stderr, { color: false });
    log.debug('hidden');
    log.setLevel('verbose');
    log.debug('shown');
    expect(s.err()).toBe('debug: shown\n');
  });

  it('should color prefixes only when enabled', () => {
    const s = streams();
    createLogger(s.stdout, s.stderr, { color: true }).error('x');
    expect(s.err()).toBe('\u001b[31merror:\u001b[0m x\n');
  });

  it('should default to no color for non-TTY streams', () => {
    const s = streams();
    createLogger(s.stdout, s.stderr).warn('x');
    expect(s.err()).toBe('warn: x\n');
  });
});
