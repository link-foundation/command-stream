// zx compatibility layer for command-stream
// Provides zx-like API with superior built-in commands and streaming

import { $ as $tagged, sh, exec, run, quote } from './$.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Current working directory tracking (like zx's cd)
let currentCwd = process.cwd();

// Use the zx-compatible mode from the main $ function
const $ = $tagged.zx;

// zx-compatible cd function
function cd(dir) {
  if (!dir) {
    dir = os.homedir();
  }
  
  const resolvedDir = path.resolve(currentCwd, dir);
  
  // Verify directory exists
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`cd: ${dir}: No such file or directory`);
  }
  
  // Check if it's a file instead of directory
  let stats;
  try {
    stats = fs.statSync(resolvedDir);
  } catch (e) {
    throw new Error(`cd: ${dir}: No such file or directory`);
  }
  
  if (!stats.isDirectory()) {
    // Check if it exists but is not a directory (for better error message)
    if (stats.isFile()) {
      throw new Error(`cd: ${dir}: Not a directory`);
    } else {
      throw new Error(`cd: ${dir}: No such file or directory`);
    }
  }
  
  currentCwd = resolvedDir;
  process.chdir(currentCwd);
}

// zx-compatible echo function
async function echo(message) {
  console.log(message);
}

// Export the zx-compatible API
export {
  $ as default,
  $,
  cd,
  echo,
  fs,
  path,
  os
};

// Also export original command-stream functionality for advanced users
export { 
  $ as $original,
  sh,
  exec, 
  run,
  quote
} from './$.mjs';