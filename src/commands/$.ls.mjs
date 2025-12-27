import fs from 'fs';
import path from 'path';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function ls({ args, stdin, cwd }) {
  try {
    // Parse flags
    const flags = new Set();
    const paths = [];

    for (const arg of args) {
      if (arg.startsWith('-')) {
        for (const flag of arg.slice(1)) {
          flags.add(flag);
        }
      } else {
        paths.push(arg);
      }
    }

    // Default to current directory if no paths specified
    if (paths.length === 0) {
      paths.push(cwd || process.cwd());
    }

    const showAll = flags.has('a');
    const longFormat = flags.has('l');

    trace(
      'VirtualCommand',
      () =>
        `ls: listing | ${JSON.stringify({ paths, flags: Array.from(flags) }, null, 2)}`
    );

    const outputs = [];

    for (const targetPath of paths) {
      const resolvedPath = VirtualUtils.resolvePath(targetPath, cwd);
      const stats = fs.statSync(resolvedPath);

      if (stats.isDirectory()) {
        let entries = fs.readdirSync(resolvedPath);

        if (!showAll) {
          entries = entries.filter((e) => !e.startsWith('.'));
        }

        if (longFormat) {
          for (const entry of entries) {
            const entryPath = path.join(resolvedPath, entry);
            const entryStats = fs.statSync(entryPath);
            const mode = entryStats.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--';
            const size = entryStats.size.toString().padStart(8);
            const mtime = entryStats.mtime.toISOString().split('T')[0];
            outputs.push(`${mode}  1 user group ${size} ${mtime} ${entry}\n`);
          }
        } else {
          outputs.push(`${entries.join('\n')}\n`);
        }
      } else {
        // Single file
        if (longFormat) {
          const mode = '-rw-r--r--';
          const size = stats.size.toString().padStart(8);
          const mtime = stats.mtime.toISOString().split('T')[0];
          const basename = path.basename(resolvedPath);
          outputs.push(`${mode}  1 user group ${size} ${mtime} ${basename}\n`);
        } else {
          outputs.push(`${path.basename(resolvedPath)}\n`);
        }
      }
    }

    trace(
      'VirtualCommand',
      () =>
        `ls: success | ${JSON.stringify({ entriesCount: outputs.length }, null, 2)}`
    );
    return VirtualUtils.success(outputs.join(''));
  } catch (error) {
    trace(
      'VirtualCommand',
      () => `ls: error | ${JSON.stringify({ error: error.message }, null, 2)}`
    );
    if (error.code === 'ENOENT') {
      return VirtualUtils.error(
        `ls: ${args[0] || '.'}: No such file or directory`
      );
    }
    return VirtualUtils.error(`ls: ${error.message}`);
  }
}
