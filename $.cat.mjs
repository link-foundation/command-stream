import fs from 'fs';
import { trace, VirtualUtils } from './$.utils.mjs';

export default async function cat({ args, stdin, cwd }) {
  if (args.length === 0) {
    // Read from stdin if no files specified
    if (stdin !== undefined && stdin !== '') {
      return VirtualUtils.success(stdin);
    }
    return VirtualUtils.success();
  }

  try {
    const outputs = [];
    for (const file of args) {
      trace('VirtualCommand', () => `cat: reading file | ${JSON.stringify({ file }, null, 2)}`);
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        outputs.push(content);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return VirtualUtils.error(`cat: ${file}: No such file or directory`);
        } else if (error.code === 'EISDIR') {
          return VirtualUtils.error(`cat: ${file}: Is a directory`);
        } else {
          return VirtualUtils.error(`cat: ${file}: ${error.message}`);
        }
      }
    }
    const output = outputs.join('');
    trace('VirtualCommand', () => `cat: success | ${JSON.stringify({ bytesRead: output.length }, null, 2)}`);
    return VirtualUtils.success(output);
  } catch (error) {
    trace('VirtualCommand', () => `cat: unexpected error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`cat: ${error.message}`);
  }
}