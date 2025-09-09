import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

/**
 * Virtual implementation of the Unix 'tee' command
 * 
 * tee reads from stdin and writes to both stdout and files
 * Usage: tee [OPTION]... [FILE]...
 * Options:
 *   -a, --append    append to the given FILEs, do not overwrite
 *   -i, --ignore-interrupts    ignore interrupt signals
 *   
 * The tee command:
 * 1. Reads from stdin (or provided stdin string)
 * 2. Writes the input to stdout (so it continues through the pipeline)
 * 3. Simultaneously writes the input to all specified files
 * 4. Supports append mode with -a flag
 * 5. Works in interactive mode when stdin is provided continuously
 */
export default async function tee({ args, stdin, cwd, isCancelled, abortSignal }) {
  // Parse arguments
  let appendMode = false;
  let ignoreInterrupts = false;
  let files = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-a' || arg === '--append') {
      appendMode = true;
    } else if (arg === '-i' || arg === '--ignore-interrupts') {
      ignoreInterrupts = true;
    } else if (arg.startsWith('-')) {
      // Unknown option
      return VirtualUtils.error(`tee: unrecognized option '${arg}'`);
    } else {
      files.push(arg);
    }
  }

  trace('VirtualCommand', () => `tee: starting | ${JSON.stringify({ 
    appendMode, 
    ignoreInterrupts,
    files, 
    hasStdin: !!stdin,
    stdinLength: stdin?.length || 0
  }, null, 2)}`);

  // Handle the case where no stdin is provided - still need to create empty files
  const input = (stdin === undefined || stdin === '') ? '' : (typeof stdin === 'string' ? stdin : stdin.toString());

  try {
    
    // Write to all specified files
    for (const file of files) {
      // Check for cancellation before processing each file
      if (!ignoreInterrupts && (isCancelled?.() || abortSignal?.aborted)) {
        trace('VirtualCommand', () => `tee: cancelled while processing files`);
        return { code: 130, stdout: input, stderr: '' }; // SIGINT exit code, but still output what we have
      }
      
      const resolvedPath = VirtualUtils.resolvePath(file, cwd);
      trace('VirtualCommand', () => `tee: writing to file | ${JSON.stringify({ 
        file, 
        resolvedPath, 
        appendMode,
        bytesToWrite: input.length 
      }, null, 2)}`);
      
      try {
        if (appendMode) {
          fs.appendFileSync(resolvedPath, input);
        } else {
          fs.writeFileSync(resolvedPath, input);
        }
      } catch (error) {
        // Don't fail the entire command if one file write fails
        // Still output the input to stdout but return error like Unix tee does
        trace('VirtualCommand', () => `tee: file write error | ${JSON.stringify({ 
          file, 
          error: error.message 
        }, null, 2)}`);
        return { code: 1, stdout: input, stderr: `tee: ${file}: ${error.message}` };
      }
    }

    // Always output the input to stdout (this is the key behavior of tee)
    trace('VirtualCommand', () => `tee: success | ${JSON.stringify({ 
      filesWritten: files.length,
      stdoutBytes: input.length
    }, null, 2)}`);
    
    return VirtualUtils.success(input);

  } catch (error) {
    trace('VirtualCommand', () => `tee: unexpected error | ${JSON.stringify({ 
      error: error.message 
    }, null, 2)}`);
    return VirtualUtils.error(`tee: ${error.message}`);
  }
}