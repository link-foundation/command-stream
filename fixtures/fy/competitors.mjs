#!/usr/bin/env node
// Migrate imports, not strings such as "zx" or comments: require('shelljs').
import { $ as zx } from "command-stream/zx";
import { $ as core } from "command-stream/zx/core";
import { execa } from "command-stream/execa";
import shell from "command-stream/shelljs";
import spawn from "command-stream/cross-spawn";
import { $ as bun } from "command-stream/bun";
export { $ } from "command-stream/zx/core";
const plugin = await import("command-stream/shelljs/plugin");
const text = `zx ${await import("command-stream/zx")}`;
console.log('execa', /require('zx')/, zx, core, execa, shell, spawn, bun, plugin, text);
