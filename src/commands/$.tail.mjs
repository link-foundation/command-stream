import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function tail({ args, stdin, cwd, isCancelled, abortSignal }) {
  let lines = 10; // Default number of lines
  let files = [];
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && i + 1 < args.length) {
      const lineCount = parseInt(args[i + 1]);
      if (isNaN(lineCount) || lineCount < 0) {
        return VirtualUtils.error(`tail: invalid number of lines: '${args[i + 1]}'`);
      }
      lines = lineCount;
      i++; // Skip the next argument (line count)
    } else if (args[i].startsWith('-n')) {
      // Handle -n10 format
      const lineCount = parseInt(args[i].substring(2));
      if (isNaN(lineCount) || lineCount < 0) {
        return VirtualUtils.error(`tail: invalid number of lines: '${args[i].substring(2)}'`);
      }
      lines = lineCount;
    } else if (args[i].startsWith('-') && args[i] !== '-') {
      // Handle -10 format
      const lineCount = parseInt(args[i].substring(1));
      if (!isNaN(lineCount) && lineCount > 0) {
        lines = lineCount;
      } else {
        return VirtualUtils.error(`tail: invalid option -- '${args[i].substring(1)}'`);
      }
    } else {
      files.push(args[i]);
    }
  }

  // If no files specified, read from stdin
  if (files.length === 0) {
    if (stdin !== undefined && stdin !== '') {
      const inputLines = stdin.split('\n');
      // Remove empty last line if input doesn't end with newline
      if (inputLines.length > 0 && inputLines[inputLines.length - 1] === '') {
        inputLines.pop();
      }
      const output = inputLines.slice(-lines).join('\n');
      return VirtualUtils.success(output + (inputLines.length > 0 ? '\n' : ''));
    }
    return VirtualUtils.success();
  }

  try {
    const outputs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check for cancellation
      if (isCancelled?.() || abortSignal?.aborted) {
        trace('VirtualCommand', () => `tail: cancelled while processing files`);
        return { code: 130, stdout: '', stderr: '' };
      }
      
      trace('VirtualCommand', () => `tail: reading file | ${JSON.stringify({ file, lines }, null, 2)}`);
      
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        const fileLines = content.split('\n');
        
        // Remove empty last line if file doesn't end with newline
        if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') {
          fileLines.pop();
        }
        
        const tailLines = fileLines.slice(-lines);
        
        // Add header if multiple files
        let output = '';
        if (files.length > 1) {
          output += (i > 0 ? '\n' : '') + `==> ${file} <==\n`;
        }
        output += tailLines.join('\n');
        
        // Add trailing newline if original had content
        if (tailLines.length > 0) {
          output += '\n';
        }
        
        outputs.push(output);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return VirtualUtils.error(`tail: cannot open '${file}' for reading: No such file or directory`);
        } else if (error.code === 'EISDIR') {
          return VirtualUtils.error(`tail: error reading '${file}': Is a directory`);
        } else {
          return VirtualUtils.error(`tail: ${file}: ${error.message}`);
        }
      }
    }
    
    const result = outputs.join('');
    trace('VirtualCommand', () => `tail: success | ${JSON.stringify({ files: files.length, lines }, null, 2)}`);
    return VirtualUtils.success(result);
  } catch (error) {
    trace('VirtualCommand', () => `tail: unexpected error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`tail: ${error.message}`);
  }
}