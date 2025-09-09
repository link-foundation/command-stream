import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function head({ args, stdin, cwd, isCancelled, abortSignal }) {
  let lines = 10; // Default number of lines
  let files = [];
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && i + 1 < args.length) {
      const lineCount = parseInt(args[i + 1]);
      if (isNaN(lineCount) || lineCount < 0) {
        return VirtualUtils.error(`head: invalid number of lines: '${args[i + 1]}'`);
      }
      lines = lineCount;
      i++; // Skip the next argument (line count)
    } else if (args[i].startsWith('-n')) {
      // Handle -n10 format
      const lineCount = parseInt(args[i].substring(2));
      if (isNaN(lineCount) || lineCount < 0) {
        return VirtualUtils.error(`head: invalid number of lines: '${args[i].substring(2)}'`);
      }
      lines = lineCount;
    } else if (args[i].startsWith('-') && args[i] !== '-') {
      // Handle -10 format
      const lineCount = parseInt(args[i].substring(1));
      if (!isNaN(lineCount) && lineCount > 0) {
        lines = lineCount;
      } else {
        return VirtualUtils.error(`head: invalid option -- '${args[i].substring(1)}'`);
      }
    } else {
      files.push(args[i]);
    }
  }

  // If no files specified, read from stdin
  if (files.length === 0) {
    if (stdin !== undefined && stdin !== '') {
      const inputLines = stdin.split('\n');
      const output = inputLines.slice(0, lines).join('\n');
      return VirtualUtils.success(output + (inputLines.length > lines ? '\n' : ''));
    }
    return VirtualUtils.success();
  }

  try {
    const outputs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check for cancellation
      if (isCancelled?.() || abortSignal?.aborted) {
        trace('VirtualCommand', () => `head: cancelled while processing files`);
        return { code: 130, stdout: '', stderr: '' };
      }
      
      trace('VirtualCommand', () => `head: reading file | ${JSON.stringify({ file, lines }, null, 2)}`);
      
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        const fileLines = content.split('\n');
        const headLines = fileLines.slice(0, lines);
        
        // Add header if multiple files
        let output = '';
        if (files.length > 1) {
          output += (i > 0 ? '\n' : '') + `==> ${file} <==\n`;
        }
        output += headLines.join('\n');
        
        // Add trailing newline if original had one or if we're showing fewer lines
        if (content.endsWith('\n') || fileLines.length > lines) {
          output += '\n';
        }
        
        outputs.push(output);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return VirtualUtils.error(`head: cannot open '${file}' for reading: No such file or directory`);
        } else if (error.code === 'EISDIR') {
          return VirtualUtils.error(`head: error reading '${file}': Is a directory`);
        } else {
          return VirtualUtils.error(`head: ${file}: ${error.message}`);
        }
      }
    }
    
    const result = outputs.join('');
    trace('VirtualCommand', () => `head: success | ${JSON.stringify({ files: files.length, lines }, null, 2)}`);
    return VirtualUtils.success(result);
  } catch (error) {
    trace('VirtualCommand', () => `head: unexpected error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`head: ${error.message}`);
  }
}