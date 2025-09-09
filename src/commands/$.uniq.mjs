import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function uniq({ args, stdin, cwd, isCancelled, abortSignal }) {
  let count = false;
  let duplicatesOnly = false;
  let uniquesOnly = false;
  let ignoreCase = false;
  let files = [];
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '--count') {
      count = true;
    } else if (args[i] === '-d' || args[i] === '--repeated') {
      duplicatesOnly = true;
    } else if (args[i] === '-u' || args[i] === '--unique') {
      uniquesOnly = true;
    } else if (args[i] === '-i' || args[i] === '--ignore-case') {
      ignoreCase = true;
    } else if (args[i].startsWith('-') && args[i] !== '-') {
      // Handle combined flags like -cd, -cu, etc.
      const flags = args[i].substring(1);
      for (const flag of flags) {
        if (flag === 'c') {
          count = true;
        } else if (flag === 'd') {
          duplicatesOnly = true;
        } else if (flag === 'u') {
          uniquesOnly = true;
        } else if (flag === 'i') {
          ignoreCase = true;
        } else {
          return VirtualUtils.error(`uniq: invalid option -- '${flag}'`);
        }
      }
    } else {
      files.push(args[i]);
    }
  }

  // Cannot use both -d and -u at the same time
  if (duplicatesOnly && uniquesOnly) {
    return VirtualUtils.error(`uniq: printing duplicated lines and unique lines is meaningless`);
  }

  try {
    let allLines = [];

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
      // Read from the first file (uniq typically processes one file)
      const file = files[0];
      
      // Check for cancellation
      if (isCancelled?.() || abortSignal?.aborted) {
        trace('VirtualCommand', () => `uniq: cancelled while processing file`);
        return { code: 130, stdout: '', stderr: '' };
      }
      
      trace('VirtualCommand', () => `uniq: reading file | ${JSON.stringify({ file }, null, 2)}`);
      
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        allLines = content.split('\n');
        // Remove empty last line if file doesn't end with newline
        if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
          allLines.pop();
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return VirtualUtils.error(`uniq: ${file}: No such file or directory`);
        } else if (error.code === 'EISDIR') {
          return VirtualUtils.error(`uniq: ${file}: Is a directory`);
        } else {
          return VirtualUtils.error(`uniq: ${file}: ${error.message}`);
        }
      }
    }

    // Process consecutive duplicate lines
    const result = [];
    const lineCounts = new Map();
    let currentLine = null;
    let currentCount = 0;
    
    for (const line of allLines) {
      const compareLine = ignoreCase ? line.toLowerCase() : line;
      
      if (currentLine === null) {
        currentLine = line;
        currentCount = 1;
      } else if ((ignoreCase ? currentLine.toLowerCase() : currentLine) === compareLine) {
        currentCount++;
      } else {
        // Process the previous group
        lineCounts.set(currentLine, currentCount);
        
        if (count) {
          result.push(`${currentCount.toString().padStart(7)} ${currentLine}`);
        } else if (duplicatesOnly && currentCount > 1) {
          result.push(currentLine);
        } else if (uniquesOnly && currentCount === 1) {
          result.push(currentLine);
        } else if (!duplicatesOnly && !uniquesOnly) {
          result.push(currentLine);
        }
        
        currentLine = line;
        currentCount = 1;
      }
    }
    
    // Handle the last group
    if (currentLine !== null) {
      lineCounts.set(currentLine, currentCount);
      
      if (count) {
        result.push(`${currentCount.toString().padStart(7)} ${currentLine}`);
      } else if (duplicatesOnly && currentCount > 1) {
        result.push(currentLine);
      } else if (uniquesOnly && currentCount === 1) {
        result.push(currentLine);
      } else if (!duplicatesOnly && !uniquesOnly) {
        result.push(currentLine);
      }
    }

    const output = result.join('\n') + (result.length > 0 ? '\n' : '');
    
    trace('VirtualCommand', () => `uniq: success | ${JSON.stringify({ 
      inputLines: allLines.length,
      outputLines: result.length,
      flags: { count, duplicatesOnly, uniquesOnly, ignoreCase }
    }, null, 2)}`);
    
    return VirtualUtils.success(output);
  } catch (error) {
    trace('VirtualCommand', () => `uniq: unexpected error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`uniq: ${error.message}`);
  }
}