import { describe, expect, it } from 'vitest';
import { createProgram } from './program.js';

describe('given the ahm program', () => {
  it('should be named ahm', () => {
    expect(createProgram().name()).toBe('ahm');
  });

  it('should expose the package version', () => {
    expect(createProgram().version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
