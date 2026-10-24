#!/usr/bin/env node
// Migrate imports, not strings such as "zx" or comments: require('shelljs').
import { $ as zx } from 'zx';
import { $ as core } from 'zx/core';
import { execa } from 'execa';
import shell from 'shelljs';
import spawn from 'cross-spawn';
import { $ as bun } from 'bun';
export { $ } from 'zx/core';
const plugin = await import('shelljs/plugin');
const text = `zx ${await import('zx')}`;
console.log('execa', /require('zx')/, zx, core, execa, shell, spawn, bun, plugin, text);
