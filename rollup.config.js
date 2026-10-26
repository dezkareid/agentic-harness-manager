import { builtinModules } from 'node:module';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import pkg from './package.json' with { type: 'json' };

const deps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
const builtins = [...builtinModules, ...builtinModules.map(m => `node:${m}`)];
const external = id => builtins.includes(id) || deps.some(dep => id === dep || id.startsWith(`${dep}/`));

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'esm',
      sourcemap: true,
      banner: '#!/usr/bin/env node',
    },
    plugins: [
      json(),
      typescript({ exclude: ['**/*.spec.ts'] }),
      resolve(),
      commonjs(),
    ],
    external,
  },
];
