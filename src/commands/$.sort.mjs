import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function sort({ args, stdin, cwd, isCancelled, abortSignal }) {
  let reverse = false;
  let numeric = false;
  let unique = false;
  let files = [];
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-r' || args[i] === '--reverse') {
      reverse = true;
    } else if (args[i] === '-n' || args[i] === '--numeric-sort') {
      numeric = true;
    } else if (args[i] === '-u' || args[i] === '--unique') {
      unique = true;
    } else if (args[i].startsWith('-') && args[i] !== '-') {
      // Handle combined flags like -rn, -nr, -ru, etc.
      const flags = args[i].substring(1);
      for (const flag of flags) {
        if (flag === 'r') {
          reverse = true;
        } else if (flag === 'n') {
          numeric = true;
        } else if (flag === 'u') {
          unique = true;
        } else {
          return VirtualUtils.error(`sort: invalid option -- '${flag}'`);
        }
      }
    } else {
      files.push(args[i]);
    }
  }

  // Collect all lines to sort
  let allLines = [];

  try {
    // If no files specified, read from stdin
    if (files.length === 0) {
      if (stdin !== undefined && stdin !== '') {
        allLines = stdin.split('\n');
        // Remove empty last line if input doesn't end with newline
        if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
          allLines.pop();
        }
      }
    } else {
      // Read from all specified files
      for (const file of files) {
        // Check for cancellation
        if (isCancelled?.() || abortSignal?.aborted) {
          trace('VirtualCommand', () => `sort: cancelled while processing files`);
          return { code: 130, stdout: '', stderr: '' };
        }
        
        trace('VirtualCommand', () => `sort: reading file | ${JSON.stringify({ file }, null, 2)}`);
        
        const resolvedPath = VirtualUtils.resolvePath(file, cwd);
        try {
          const content = fs.readFileSync(resolvedPath, 'utf8');
          const fileLines = content.split('\n');
          // Remove empty last line if file doesn't end with newline
          if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') {
            fileLines.pop();
          }
          allLines.push(...fileLines);
        } catch (error) {
          if (error.code === 'ENOENT') {
            return VirtualUtils.error(`sort: cannot read: ${file}: No such file or directory`);
          } else if (error.code === 'EISDIR') {
            return VirtualUtils.error(`sort: read failed: ${file}: Is a directory`);
          } else {
            return VirtualUtils.error(`sort: ${file}: ${error.message}`);
          }
        }
      }
    }

    // Remove duplicates if unique flag is set
    if (unique) {
      allLines = [...new Set(allLines)];
    }

    // Sort the lines
    if (numeric) {
      allLines.sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        
        // Handle non-numeric strings
        if (isNaN(numA) && isNaN(numB)) {
          return a.localeCompare(b);
        } else if (isNaN(numA)) {
          return 1; // Non-numeric goes to end
        } else if (isNaN(numB)) {
          return -1; // Non-numeric goes to end
        }
        
        return numA - numB;
      });
    } else {
      // Lexicographic sort
      allLines.sort((a, b) => a.localeCompare(b));
    }

    // Reverse if requested
    if (reverse) {
      allLines.reverse();
    }

    const output = allLines.join('\n') + (allLines.length > 0 ? '\n' : '');
    
    trace('VirtualCommand', () => `sort: success | ${JSON.stringify({ 
      files: files.length, 
      lines: allLines.length, 
      flags: { reverse, numeric, unique }
    }, null, 2)}`);
    
    return VirtualUtils.success(output);
  } catch (error) {
    trace('VirtualCommand', () => `sort: unexpected error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`sort: ${error.message}`);
  }
}