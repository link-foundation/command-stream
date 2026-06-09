// ProcessRunner execution methods - start, sync, async, and related methods
// Part of the modular ProcessRunner architecture

import cp from 'child_process';
import { trace } from './$.trace.mjs';
import { findAvailableShell } from './$.shell.mjs';
import { StreamUtils, safeWrite, asBuffer } from './$.stream-utils.mjs';
import { pumpReadable } from './$.quote.mjs';
import { createResult } from './$.result.mjs';
import { parseShellCommand, needsRealShell } from './shell-parser.mjs';

const isBun = typeof globalThis.Bun !== 'undefined';

/**
 * Check for shell operators in command
 * @param {string} command - Command to check
 * @returns {boolean}
 */
function hasShellOperators(command) {
  return (
    command.includes('&&') ||
    command.includes('||') ||
    command.includes('(') ||
    command.includes(';') ||
    (command.includes('cd ') && command.includes('&&'))
  );
}

/**
 * Check if command is a streaming pattern
 * @param {string} command - Command to check
 * @returns {boolean}
 */
function isStreamingPattern(command) {
  return (
    command.includes('sleep') &&
    command.includes(';') &&
    (command.includes('echo') || command.includes('printf'))
  );
}

/**
 * Determine if shell operators should be used
 * @param {object} runner - ProcessRunner instance
 * @param {string} command - Command to check
 * @returns {boolean}
 */
function shouldUseShellOperators(runner, command) {
  const hasOps = hasShellOperators(command);
  const isStreaming = isStreamingPattern(command);
  return (
    runner.options.shellOperators &&
    hasOps &&
    !isStreaming &&
    !runner._isStreaming
  );
}

/**
 * Check if stdin is interactive
 * @param {string} stdin - Stdin option
 * @param {object} options - Runner options
 * @returns {boolean}
 */
function isInteractiveMode(stdin, options) {
  return (
    stdin === 'inherit' &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    process.stderr.isTTY === true &&
    options.interactive === true
  );
}

/**
 * Spawn process using Bun
 * @param {Array} argv - Command arguments
 * @param {object} config - Spawn configuration
 * @returns {object} Child process
 */
function spawnWithBun(argv, config) {
  const { cwd, env, isInteractive } = config;

  trace(
    'ProcessRunner',
    () =>
      `spawnBun: Creating process | ${JSON.stringify({
        command: argv[0],
        args: argv.slice(1),
        isInteractive,
        cwd,
        platform: process.platform,
      })}`
  );

  if (isInteractive) {
    trace(
      'ProcessRunner',
      () => `spawnBun: Using interactive mode with inherited stdio`
    );
    return Bun.spawn(argv, {
      cwd,
      env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
  }

  trace(
    'ProcessRunner',
    () =>
      `spawnBun: Using non-interactive mode with pipes and detached=${process.platform !== 'win32'}`
  );

  return Bun.spawn(argv, {
    cwd,
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: process.platform !== 'win32',
  });
}

/**
 * Spawn process using Node
 * @param {Array} argv - Command arguments
 * @param {object} config - Spawn configuration
 * @returns {object} Child process
 */
function spawnWithNode(argv, config) {
  const { cwd, env, isInteractive } = config;

  trace(
    'ProcessRunner',
    () =>
      `spawnNode: Creating process | ${JSON.stringify({
        command: argv[0],
        args: argv.slice(1),
        isInteractive,
        cwd,
        platform: process.platform,
      })}`
  );

  if (isInteractive) {
    return cp.spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: 'inherit',
    });
  }

  const child = cp.spawn(argv[0], argv.slice(1), {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  trace(
    'ProcessRunner',
    () =>
      `spawnNode: Process created | ${JSON.stringify({
        pid: child.pid,
        killed: child.killed,
        hasStdout: !!child.stdout,
        hasStderr: !!child.stderr,
        hasStdin: !!child.stdin,
      })}`
  );

  return child;
}

/**
 * Spawn child process with appropriate runtime
 * @param {Array} argv - Command arguments
 * @param {object} config - Spawn configuration
 * @returns {object} Child process
 */
function spawnChild(argv, config) {
  const { stdin } = config;
  const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
  const preferNodeForInput = isBun && needsExplicitPipe;

  trace(
    'ProcessRunner',
    () =>
      `About to spawn process | ${JSON.stringify({
        needsExplicitPipe,
        preferNodeForInput,
        runtime: isBun ? 'Bun' : 'Node',
        command: argv[0],
        args: argv.slice(1),
      })}`
  );

  if (preferNodeForInput) {
    return spawnWithNode(argv, config);
  }
  return isBun ? spawnWithBun(argv, config) : spawnWithNode(argv, config);
}

/**
 * Setup child process event listeners
 * @param {object} runner - ProcessRunner instance
 */
function setupChildEventListeners(runner) {
  if (!runner.child || typeof runner.child.on !== 'function') {
    return;
  }

  runner.child.on('spawn', () => {
    trace(
      'ProcessRunner',
      () =>
        `Child process spawned successfully | ${JSON.stringify({
          pid: runner.child.pid,
          command: runner.spec?.command?.slice(0, 50),
        })}`
    );
  });

  runner.child.on('error', (error) => {
    trace(
      'ProcessRunner',
      () =>
        `Child process error event | ${JSON.stringify({
          pid: runner.child?.pid,
          error: error.message,
          code: error.code,
          errno: error.errno,
          syscall: error.syscall,
          command: runner.spec?.command?.slice(0, 50),
        })}`
    );
  });
}

/**
 * Create stdout pump
 * @param {object} runner - ProcessRunner instance
 * @param {number} childPid - Child process PID
 * @returns {Promise}
 */
function createStdoutPump(runner, childPid) {
  if (!runner.child.stdout) {
    return Promise.resolve();
  }

  return pumpReadable(runner.child.stdout, (buf) => {
    trace(
      'ProcessRunner',
      () =>
        `stdout data received | ${JSON.stringify({
          pid: childPid,
          bufferLength: buf.length,
          capture: runner.options.capture,
          mirror: runner.options.mirror,
          preview: buf.toString().slice(0, 100),
        })}`
    );

    if (runner.options.capture) {
      runner.outChunks.push(buf);
    }
    if (runner.options.mirror) {
      safeWrite(process.stdout, buf);
    }

    runner._emitProcessedData('stdout', buf);
  });
}

/**
 * Create stderr pump
 * @param {object} runner - ProcessRunner instance
 * @param {number} childPid - Child process PID
 * @returns {Promise}
 */
function createStderrPump(runner, childPid) {
  if (!runner.child.stderr) {
    return Promise.resolve();
  }

  return pumpReadable(runner.child.stderr, (buf) => {
    trace(
      'ProcessRunner',
      () =>
        `stderr data received | ${JSON.stringify({
          pid: childPid,
          bufferLength: buf.length,
          capture: runner.options.capture,
          mirror: runner.options.mirror,
          preview: buf.toString().slice(0, 100),
        })}`
    );

    if (runner.options.capture) {
      runner.errChunks.push(buf);
    }
    if (runner.options.mirror) {
      safeWrite(process.stderr, buf);
    }

    runner._emitProcessedData('stderr', buf);
  });
}

/**
 * Handle stdin for inherit mode
 * @param {object} runner - ProcessRunner instance
 * @param {boolean} isInteractive - Is interactive mode
 * @returns {Promise}
 */
function handleInheritStdin(runner, isInteractive) {
  if (isInteractive) {
    trace(
      'ProcessRunner',
      () => `stdin: Using inherit mode for interactive command`
    );
    return Promise.resolve();
  }

  const isPipedIn = process.stdin && process.stdin.isTTY === false;
  trace(
    'ProcessRunner',
    () =>
      `stdin: Non-interactive inherit mode | ${JSON.stringify({
        isPipedIn,
        stdinTTY: process.stdin.isTTY,
      })}`
  );

  if (isPipedIn) {
    trace('ProcessRunner', () => `stdin: Pumping piped input to child process`);
    return runner._pumpStdinTo(
      runner.child,
      runner.options.capture ? runner.inChunks : null
    );
  }

  trace(
    'ProcessRunner',
    () => `stdin: Forwarding TTY stdin for non-interactive command`
  );
  return runner._forwardTTYStdin();
}

/**
 * Handle stdin based on configuration
 * @param {object} runner - ProcessRunner instance
 * @param {string|Buffer} stdin - Stdin configuration
 * @param {boolean} isInteractive - Is interactive mode
 * @returns {Promise}
 */
function handleStdin(runner, stdin, isInteractive) {
  trace(
    'ProcessRunner',
    () =>
      `Setting up stdin handling | ${JSON.stringify({
        stdinType: typeof stdin,
        stdin:
          stdin === 'inherit'
            ? 'inherit'
            : stdin === 'ignore'
              ? 'ignore'
              : typeof stdin === 'string'
                ? `string(${stdin.length})`
                : 'other',
        isInteractive,
        hasChildStdin: !!runner.child?.stdin,
        processTTY: process.stdin.isTTY,
      })}`
  );

  if (stdin === 'inherit') {
    return handleInheritStdin(runner, isInteractive);
  }

  if (stdin === 'ignore') {
    trace('ProcessRunner', () => `stdin: Ignoring and closing stdin`);
    if (runner.child.stdin && typeof runner.child.stdin.end === 'function') {
      runner.child.stdin.end();
    }
    return Promise.resolve();
  }

  if (stdin === 'pipe') {
    trace(
      'ProcessRunner',
      () => `stdin: Using pipe mode - leaving stdin open for manual control`
    );
    return Promise.resolve();
  }

  if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
    const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
    trace(
      'ProcessRunner',
      () =>
        `stdin: Writing buffer to child | ${JSON.stringify({
          bufferLength: buf.length,
          willCapture: runner.options.capture && !!runner.inChunks,
        })}`
    );
    if (runner.options.capture && runner.inChunks) {
      runner.inChunks.push(Buffer.from(buf));
    }
    return runner._writeToStdin(buf);
  }

  return Promise.resolve();
}

/**
 * Create promise for child exit
 * @param {object} child - Child process
 * @returns {Promise}
 */
function createExitPromise(child) {
  if (isBun) {
    return child.exited;
  }

  return new Promise((resolve) => {
    trace(
      'ProcessRunner',
      () => `Setting up child process event listeners for PID ${child.pid}`
    );

    child.on('close', (code, signal) => {
      trace(
        'ProcessRunner',
        () =>
          `Child process close event | ${JSON.stringify({
            pid: child.pid,
            code,
            signal,
            killed: child.killed,
            exitCode: child.exitCode,
            signalCode: child.signalCode,
          })}`
      );
      resolve(code);
    });

    child.on('exit', (code, signal) => {
      trace(
        'ProcessRunner',
        () =>
          `Child process exit event | ${JSON.stringify({
            pid: child.pid,
            code,
            signal,
            killed: child.killed,
            exitCode: child.exitCode,
            signalCode: child.signalCode,
          })}`
      );
    });
  });
}

/**
 * Determine final exit code
 * @param {number|null|undefined} code - Raw exit code
 * @param {boolean} cancelled - Was process cancelled
 * @returns {number}
 */
function determineFinalExitCode(code, cancelled) {
  trace(
    'ProcessRunner',
    () =>
      `Raw exit code from child | ${JSON.stringify({
        code,
        codeType: typeof code,
        cancelled,
        isBun,
      })}`
  );

  if (code !== undefined && code !== null) {
    return code;
  }

  if (cancelled) {
    trace(
      'ProcessRunner',
      () => `Process was killed, using SIGTERM exit code 143`
    );
    return 143;
  }

  trace('ProcessRunner', () => `Process exited without code, defaulting to 0`);
  return 0;
}

/**
 * Build result data from runner state
 * @param {object} runner - ProcessRunner instance
 * @param {number} exitCode - Exit code
 * @returns {object}
 */
function buildResultData(runner, exitCode) {
  return {
    code: exitCode,
    stdout: runner.options.capture
      ? runner.outChunks && runner.outChunks.length > 0
        ? Buffer.concat(runner.outChunks).toString('utf8')
        : ''
      : undefined,
    stderr: runner.options.capture
      ? runner.errChunks && runner.errChunks.length > 0
        ? Buffer.concat(runner.errChunks).toString('utf8')
        : ''
      : undefined,
    stdin:
      runner.options.capture && runner.inChunks
        ? Buffer.concat(runner.inChunks).toString('utf8')
        : undefined,
    child: runner.child,
  };
}

/**
 * Throw errexit error if needed
 * @param {object} runner - ProcessRunner instance
 * @param {object} globalShellSettings - Shell settings
 */
function throwErrexitIfNeeded(runner, globalShellSettings) {
  if (!globalShellSettings.errexit || runner.result.code === 0) {
    return;
  }

  trace('ProcessRunner', () => `Errexit mode: throwing error`);

  const error = new Error(
    `Command failed with exit code ${runner.result.code}`
  );
  error.code = runner.result.code;
  error.stdout = runner.result.stdout;
  error.stderr = runner.result.stderr;
  error.result = runner.result;

  throw error;
}

/**
 * Get stdin input for sync spawn
 * @param {string|Buffer} stdin - Stdin option
 * @returns {Buffer|undefined}
 */
function getSyncStdinInput(stdin) {
  if (typeof stdin === 'string') {
    return Buffer.from(stdin);
  }
  if (Buffer.isBuffer(stdin)) {
    return stdin;
  }
  return undefined;
}

/**
 * Get stdin string for result
 * @param {string|Buffer} stdin - Stdin option
 * @returns {string}
 */
function getStdinString(stdin) {
  if (typeof stdin === 'string') {
    return stdin;
  }
  if (Buffer.isBuffer(stdin)) {
    return stdin.toString('utf8');
  }
  return '';
}

/**
 * Execute sync process using Bun
 * @param {Array} argv - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} Result object
 */
function executeSyncBun(argv, options) {
  const { cwd, env, stdin } = options;
  const proc = Bun.spawnSync(argv, {
    cwd,
    env,
    stdin: getSyncStdinInput(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const result = createResult({
    code: proc.exitCode || 0,
    stdout: proc.stdout?.toString('utf8') || '',
    stderr: proc.stderr?.toString('utf8') || '',
    stdin: getStdinString(stdin),
  });
  result.child = proc;
  return result;
}

/**
 * Execute sync process using Node
 * @param {Array} argv - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} Result object
 */
function executeSyncNode(argv, options) {
  const { cwd, env, stdin } = options;
  const proc = cp.spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    input: getSyncStdinInput(stdin),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const result = createResult({
    code: proc.status || 0,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    stdin: getStdinString(stdin),
  });
  result.child = proc;
  return result;
}

/**
 * Execute sync process with appropriate runtime
 * @param {Array} argv - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} Result object
 */
function executeSyncProcess(argv, options) {
  return isBun ? executeSyncBun(argv, options) : executeSyncNode(argv, options);
}

/**
 * Handle sync result processing
 * @param {object} runner - ProcessRunner instance
 * @param {object} result - Result object
 * @param {object} globalShellSettings - Shell settings
 * @returns {object} Result
 */
function processSyncResult(runner, result, globalShellSettings) {
  if (runner.options.mirror) {
    if (result.stdout) {
      safeWrite(process.stdout, result.stdout);
    }
    if (result.stderr) {
      safeWrite(process.stderr, result.stderr);
    }
  }

  runner.outChunks = result.stdout ? [Buffer.from(result.stdout)] : [];
  runner.errChunks = result.stderr ? [Buffer.from(result.stderr)] : [];

  if (result.stdout) {
    runner._emitProcessedData('stdout', Buffer.from(result.stdout));
  }
  if (result.stderr) {
    runner._emitProcessedData('stderr', Buffer.from(result.stderr));
  }

  runner.finish(result);

  if (globalShellSettings.errexit && result.code !== 0) {
    const error = new Error(`Command failed with exit code ${result.code}`);
    error.code = result.code;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.result = result;
    throw error;
  }

  return result;
}

/**
 * Setup external abort signal listener
 * @param {object} runner - ProcessRunner instance
 */
function setupExternalAbortSignal(runner) {
  const signal = runner.options.signal;
  if (!signal || typeof signal.addEventListener !== 'function') {
    return;
  }

  trace(
    'ProcessRunner',
    () =>
      `Setting up external abort signal listener | ${JSON.stringify({
        hasSignal: !!signal,
        signalAborted: signal.aborted,
        hasInternalController: !!runner._abortController,
        internalAborted: runner._abortController?.signal.aborted,
      })}`
  );

  signal.addEventListener('abort', () => {
    trace(
      'ProcessRunner',
      () =>
        `External abort signal triggered | ${JSON.stringify({
          externalSignalAborted: signal.aborted,
          hasInternalController: !!runner._abortController,
          internalAborted: runner._abortController?.signal.aborted,
          command: runner.spec?.command?.slice(0, 50),
        })}`
    );

    runner.kill('SIGTERM');
    trace(
      'ProcessRunner',
      () => 'Process kill initiated due to external abort signal'
    );

    if (runner._abortController && !runner._abortController.signal.aborted) {
      trace(
        'ProcessRunner',
        () => 'Aborting internal controller due to external signal'
      );
      runner._abortController.abort();
    }
  });

  if (signal.aborted) {
    trace(
      'ProcessRunner',
      () =>
        `External signal already aborted, killing process and aborting internal controller`
    );
    runner.kill('SIGTERM');
    if (runner._abortController && !runner._abortController.signal.aborted) {
      runner._abortController.abort();
    }
  }
}

/**
 * Reinitialize capture chunks when capture option changes
 * @param {object} runner - ProcessRunner instance
 */
function reinitCaptureChunks(runner) {
  trace(
    'ProcessRunner',
    () =>
      `BRANCH: capture => REINIT_CHUNKS | ${JSON.stringify({
        capture: runner.options.capture,
      })}`
  );

  runner.outChunks = runner.options.capture ? [] : null;
  runner.errChunks = runner.options.capture ? [] : null;
  runner.inChunks =
    runner.options.capture && runner.options.stdin === 'inherit'
      ? []
      : runner.options.capture &&
          (typeof runner.options.stdin === 'string' ||
            Buffer.isBuffer(runner.options.stdin))
        ? [Buffer.from(runner.options.stdin)]
        : [];
}

/**
 * Try running command via enhanced shell parser
 * @param {object} runner - ProcessRunner instance
 * @param {string} command - Command to parse
 * @returns {Promise<object>|null} Result if handled, null if not
 */
async function tryEnhancedShellParser(runner, command) {
  const enhancedParsed = parseShellCommand(command);
  if (!enhancedParsed || enhancedParsed.type === 'simple') {
    return null;
  }

  trace(
    'ProcessRunner',
    () =>
      `Using enhanced parser for shell operators | ${JSON.stringify({
        type: enhancedParsed.type,
        command: command.slice(0, 50),
      })}`
  );

  if (enhancedParsed.type === 'sequence') {
    return await runner._runSequence(enhancedParsed);
  }
  if (enhancedParsed.type === 'subshell') {
    return await runner._runSubshell(enhancedParsed);
  }
  if (enhancedParsed.type === 'pipeline') {
    return await runner._runPipeline(enhancedParsed.commands);
  }

  return null;
}

/**
 * Try running command as virtual command
 * @param {object} runner - ProcessRunner instance
 * @param {object} parsed - Parsed command
 * @param {object} deps - Dependencies
 * @returns {Promise<object>|null} Result if handled, null if not
 */
async function tryVirtualCommand(runner, parsed, deps) {
  const { virtualCommands, isVirtualCommandsEnabled } = deps;

  if (
    parsed.type !== 'simple' ||
    !isVirtualCommandsEnabled() ||
    !virtualCommands.has(parsed.cmd) ||
    runner.options._bypassVirtual
  ) {
    return null;
  }

  const hasCustomStdin =
    runner.options.stdin &&
    runner.options.stdin !== 'inherit' &&
    runner.options.stdin !== 'ignore';

  const commandsThatNeedRealStdin = ['sleep', 'cat'];
  const shouldBypassVirtual =
    hasCustomStdin && commandsThatNeedRealStdin.includes(parsed.cmd);

  if (shouldBypassVirtual) {
    trace(
      'ProcessRunner',
      () =>
        `Bypassing built-in virtual command due to custom stdin | ${JSON.stringify(
          {
            cmd: parsed.cmd,
            stdin: typeof runner.options.stdin,
          }
        )}`
    );
    return null;
  }

  trace(
    'ProcessRunner',
    () =>
      `BRANCH: virtualCommand => ${parsed.cmd} | ${JSON.stringify({
        isVirtual: true,
        args: parsed.args,
      })}`
  );

  return await runner._runVirtual(parsed.cmd, parsed.args, runner.spec.command);
}

/**
 * Log xtrace/verbose if enabled
 * @param {object} globalShellSettings - Shell settings
 * @param {string} command - Command or argv
 */
function logShellTrace(globalShellSettings, command) {
  if (globalShellSettings.xtrace) {
    console.log(`+ ${command}`);
  }
  if (globalShellSettings.verbose) {
    console.log(command);
  }
}

/**
 * Handle shell mode execution
 * @param {object} runner - ProcessRunner instance
 * @param {object} deps - Dependencies
 * @returns {Promise<object>|null} Result if handled by special cases
 */
async function handleShellMode(runner, deps) {
  const { virtualCommands, isVirtualCommandsEnabled } = deps;
  const command = runner.spec.command;

  trace(
    'ProcessRunner',
    () => `BRANCH: spec.mode => shell | ${JSON.stringify({})}`
  );

  const useShellOps = shouldUseShellOperators(runner, command);

  trace(
    'ProcessRunner',
    () =>
      `Shell operator detection | ${JSON.stringify({
        hasShellOperators: hasShellOperators(command),
        shellOperatorsEnabled: runner.options.shellOperators,
        isStreamingPattern: isStreamingPattern(command),
        isStreaming: runner._isStreaming,
        shouldUseShellOperators: useShellOps,
        command: command.slice(0, 100),
      })}`
  );

  if (
    !runner.options._bypassVirtual &&
    useShellOps &&
    !needsRealShell(command)
  ) {
    const result = await tryEnhancedShellParser(runner, command);
    if (result) {
      return result;
    }
  }

  const parsed = runner._parseCommand(command);
  trace(
    'ProcessRunner',
    () =>
      `Parsed command | ${JSON.stringify({
        type: parsed?.type,
        cmd: parsed?.cmd,
        argsCount: parsed?.args?.length,
      })}`
  );

  if (parsed) {
    if (parsed.type === 'pipeline') {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: parsed.type => pipeline | ${JSON.stringify({
            commandCount: parsed.commands?.length,
          })}`
      );
      return await runner._runPipeline(parsed.commands);
    }

    const virtualResult = await tryVirtualCommand(runner, parsed, {
      virtualCommands,
      isVirtualCommandsEnabled,
    });
    if (virtualResult) {
      return virtualResult;
    }
  }

  return null;
}

/**
 * Execute child process and collect results
 * @param {object} runner - ProcessRunner instance
 * @param {Array} argv - Command arguments
 * @param {object} config - Spawn configuration
 * @returns {Promise<object>} Result
 */
async function executeChildProcess(runner, argv, config) {
  const { stdin, isInteractive } = config;

  runner.child = spawnChild(argv, config);

  if (runner.child) {
    trace(
      'ProcessRunner',
      () =>
        `Child process created | ${JSON.stringify({
          pid: runner.child.pid,
          detached: runner.child.options?.detached,
          killed: runner.child.killed,
          hasStdout: !!runner.child.stdout,
          hasStderr: !!runner.child.stderr,
          hasStdin: !!runner.child.stdin,
          platform: process.platform,
          command: runner.spec?.command?.slice(0, 100),
        })}`
    );
    setupChildEventListeners(runner);
  }

  const childPid = runner.child?.pid;
  const outPump = createStdoutPump(runner, childPid);
  const errPump = createStderrPump(runner, childPid);
  const stdinPumpPromise = handleStdin(runner, stdin, isInteractive);
  const exited = createExitPromise(runner.child);

  const code = await exited;
  await Promise.all([outPump, errPump, stdinPumpPromise]);

  const finalExitCode = determineFinalExitCode(code, runner._cancelled);
  const resultData = buildResultData(runner, finalExitCode);

  trace(
    'ProcessRunner',
    () =>
      `Process completed | ${JSON.stringify({
        command: runner.command,
        finalExitCode,
        captured: runner.options.capture,
        hasStdout: !!resultData.stdout,
        hasStderr: !!resultData.stderr,
        stdoutLength: resultData.stdout?.length || 0,
        stderrLength: resultData.stderr?.length || 0,
        stdoutPreview: resultData.stdout?.slice(0, 100),
        stderrPreview: resultData.stderr?.slice(0, 100),
        childPid: runner.child?.pid,
        cancelled: runner._cancelled,
        cancellationSignal: runner._cancellationSignal,
        platform: process.platform,
        runtime: isBun ? 'Bun' : 'Node.js',
      })}`
  );

  return {
    ...resultData,
    text() {
      return Promise.resolve(resultData.stdout || '');
    },
  };
}

/**
 * Attach execution methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies (virtualCommands, globalShellSettings, isVirtualCommandsEnabled)
 */
export function attachExecutionMethods(ProcessRunner, deps) {
  const { globalShellSettings } = deps;

  // Unified start method
  ProcessRunner.prototype.start = function (options = {}) {
    const mode = options.mode || 'async';

    trace(
      'ProcessRunner',
      () =>
        `start ENTER | ${JSON.stringify({
          mode,
          options,
          started: this.started,
          hasPromise: !!this.promise,
          hasChild: !!this.child,
          command: this.spec?.command?.slice(0, 50),
        })}`
    );

    if (Object.keys(options).length > 0 && !this.started) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: options => MERGE | ${JSON.stringify({
            oldOptions: this.options,
            newOptions: options,
          })}`
      );

      this.options = { ...this.options, ...options };
      setupExternalAbortSignal(this);

      if ('capture' in options) {
        reinitCaptureChunks(this);
      }

      trace(
        'ProcessRunner',
        () =>
          `OPTIONS_MERGED | ${JSON.stringify({ finalOptions: this.options })}`
      );
    }

    if (mode === 'sync') {
      trace('ProcessRunner', () => `BRANCH: mode => sync`);
      return this._startSync();
    }

    trace('ProcessRunner', () => `BRANCH: mode => async`);
    return this._startAsync();
  };

  ProcessRunner.prototype.sync = function () {
    return this.start({ mode: 'sync' });
  };

  ProcessRunner.prototype.async = function () {
    return this.start({ mode: 'async' });
  };

  ProcessRunner.prototype.run = function (options = {}) {
    trace(
      'ProcessRunner',
      () => `run ENTER | ${JSON.stringify({ options }, null, 2)}`
    );
    return this.start(options);
  };

  ProcessRunner.prototype._startAsync = function () {
    if (this.started) {
      return this.promise;
    }
    if (this.promise) {
      return this.promise;
    }

    this.promise = this._doStartAsync();
    return this.promise;
  };

  ProcessRunner.prototype._doStartAsync = async function () {
    trace(
      'ProcessRunner',
      () =>
        `_doStartAsync ENTER | ${JSON.stringify({
          mode: this.spec.mode,
          command: this.spec.command?.slice(0, 100),
        })}`
    );

    this.started = true;
    this._mode = 'async';

    try {
      const { cwd, env, stdin } = this.options;

      // Handle pipeline mode
      if (this.spec.mode === 'pipeline') {
        trace(
          'ProcessRunner',
          () =>
            `BRANCH: spec.mode => pipeline | ${JSON.stringify({
              hasSource: !!this.spec.source,
              hasDestination: !!this.spec.destination,
            })}`
        );
        return await this._runProgrammaticPipeline(
          this.spec.source,
          this.spec.destination
        );
      }

      // Handle shell mode special cases
      if (this.spec.mode === 'shell') {
        const shellResult = await handleShellMode(this, deps);
        if (shellResult) {
          return shellResult;
        }
      }

      // Build command arguments
      const shell = findAvailableShell();
      const argv =
        this.spec.mode === 'shell'
          ? [shell.cmd, ...shell.args, this.spec.command]
          : [this.spec.file, ...this.spec.args];

      trace(
        'ProcessRunner',
        () =>
          `Constructed argv | ${JSON.stringify({
            mode: this.spec.mode,
            argv,
            originalCommand: this.spec.command,
          })}`
      );

      // Log command if tracing enabled
      const traceCmd =
        this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      logShellTrace(globalShellSettings, traceCmd);

      // Detect interactive mode
      const isInteractive = isInteractiveMode(stdin, this.options);

      trace(
        'ProcessRunner',
        () =>
          `Interactive command detection | ${JSON.stringify({
            isInteractive,
            stdinInherit: stdin === 'inherit',
            stdinTTY: process.stdin.isTTY,
            stdoutTTY: process.stdout.isTTY,
            stderrTTY: process.stderr.isTTY,
            interactiveOption: this.options.interactive,
          })}`
      );

      // Execute child process
      const result = await executeChildProcess(this, argv, {
        cwd,
        env,
        stdin,
        isInteractive,
      });

      this.finish(result);

      trace(
        'ProcessRunner',
        () =>
          `Process finished, result set | ${JSON.stringify({
            finished: this.finished,
            resultCode: this.result?.code,
          })}`
      );

      throwErrexitIfNeeded(this, globalShellSettings);

      return this.result;
    } catch (error) {
      trace(
        'ProcessRunner',
        () =>
          `Caught error in _doStartAsync | ${JSON.stringify({
            errorMessage: error.message,
            errorCode: error.code,
            isCommandError: error.isCommandError,
            hasResult: !!error.result,
            command: this.spec?.command?.slice(0, 100),
          })}`
      );

      if (!this.finished) {
        const errorResult = createResult({
          code: error.code ?? 1,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? error.message ?? '',
          stdin: '',
        });
        this.finish(errorResult);
      }

      throw error;
    }
  };

  ProcessRunner.prototype._pumpStdinTo = async function (child, captureChunks) {
    trace('ProcessRunner', () => `_pumpStdinTo ENTER`);
    if (!child.stdin) {
      return;
    }

    const bunWriter =
      isBun && child.stdin && typeof child.stdin.getWriter === 'function'
        ? child.stdin.getWriter()
        : null;

    for await (const chunk of process.stdin) {
      const buf = asBuffer(chunk);
      captureChunks && captureChunks.push(buf);
      if (bunWriter) {
        await bunWriter.write(buf);
      } else if (typeof child.stdin.write === 'function') {
        StreamUtils.addStdinErrorHandler(child.stdin, 'child stdin buffer');
        StreamUtils.safeStreamWrite(child.stdin, buf, 'child stdin buffer');
      } else if (isBun && typeof Bun.write === 'function') {
        await Bun.write(child.stdin, buf);
      }
    }

    if (bunWriter) {
      await bunWriter.close();
    } else if (typeof child.stdin.end === 'function') {
      child.stdin.end();
    }
  };

  ProcessRunner.prototype._writeToStdin = async function (buf) {
    trace('ProcessRunner', () => `_writeToStdin | len=${buf?.length || 0}`);
    const bytes =
      buf instanceof Uint8Array
        ? buf
        : new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength);

    if (await StreamUtils.writeToStream(this.child.stdin, bytes, 'stdin')) {
      if (StreamUtils.isBunStream(this.child.stdin)) {
        // Stream was already closed by writeToStream utility - no action needed
      } else if (StreamUtils.isNodeStream(this.child.stdin)) {
        try {
          this.child.stdin.end();
        } catch (_endError) {
          /* Expected when stream is already closed */
        }
      }
    } else if (isBun && typeof Bun.write === 'function') {
      await Bun.write(this.child.stdin, buf);
    }
  };

  ProcessRunner.prototype._forwardTTYStdin = function () {
    trace('ProcessRunner', () => `_forwardTTYStdin ENTER`);
    if (!process.stdin.isTTY || !this.child.stdin) {
      return;
    }

    try {
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onData = (chunk) => {
        if (chunk[0] === 3) {
          this._sendSigintToChild();
          return;
        }
        if (this.child.stdin?.write) {
          this.child.stdin.write(chunk);
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      };

      process.stdin.on('data', onData);

      const childExit = isBun
        ? this.child.exited
        : new Promise((resolve) => {
            this.child.once('close', resolve);
            this.child.once('exit', resolve);
          });

      childExit.then(cleanup).catch(cleanup);

      return childExit;
    } catch (_error) {
      // TTY forwarding error - ignore
    }
  };

  ProcessRunner.prototype._sendSigintToChild = function () {
    if (!this.child?.pid) {
      return;
    }
    try {
      if (isBun) {
        this.child.kill('SIGINT');
      } else {
        try {
          process.kill(-this.child.pid, 'SIGINT');
        } catch (_e) {
          process.kill(this.child.pid, 'SIGINT');
        }
      }
    } catch (_err) {
      // Error sending SIGINT - ignore
    }
  };

  ProcessRunner.prototype._parseCommand = function (command) {
    const trimmed = command.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.includes('|')) {
      return this._parsePipeline(trimmed);
    }

    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (parts.length === 0) {
      return null;
    }

    const cmd = parts[0];
    const args = parts.slice(1).map((arg) => {
      if (
        (arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))
      ) {
        return { value: arg.slice(1, -1), quoted: true, quoteChar: arg[0] };
      }
      return { value: arg, quoted: false };
    });

    return { cmd, args, type: 'simple' };
  };

  ProcessRunner.prototype._parsePipeline = function (command) {
    const segments = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
        current += char;
      } else if (!inQuotes && char === '|') {
        segments.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      segments.push(current.trim());
    }

    const commands = segments
      .map((segment) => {
        const parts = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        if (parts.length === 0) {
          return null;
        }

        const cmd = parts[0];
        const args = parts.slice(1).map((arg) => {
          if (
            (arg.startsWith('"') && arg.endsWith('"')) ||
            (arg.startsWith("'") && arg.endsWith("'"))
          ) {
            return { value: arg.slice(1, -1), quoted: true, quoteChar: arg[0] };
          }
          return { value: arg, quoted: false };
        });

        return { cmd, args };
      })
      .filter(Boolean);

    return { type: 'pipeline', commands };
  };

  // Sync execution
  ProcessRunner.prototype._startSync = function () {
    trace('ProcessRunner', () => `_startSync ENTER`);

    if (this.started) {
      throw new Error(
        'Command already started - cannot run sync after async start'
      );
    }

    this.started = true;
    this._mode = 'sync';

    const { cwd, env, stdin } = this.options;
    const shell = findAvailableShell();
    const argv =
      this.spec.mode === 'shell'
        ? [shell.cmd, ...shell.args, this.spec.command]
        : [this.spec.file, ...this.spec.args];

    const traceCmd =
      this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
    logShellTrace(globalShellSettings, traceCmd);

    const result = executeSyncProcess(argv, { cwd, env, stdin });
    return processSyncResult(this, result, globalShellSettings);
  };

  // Promise interface
  ProcessRunner.prototype.then = function (onFulfilled, onRejected) {
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.then(onFulfilled, onRejected);
  };

  ProcessRunner.prototype.catch = function (onRejected) {
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.catch(onRejected);
  };

  ProcessRunner.prototype.finally = function (onFinally) {
    if (!this.promise) {
      this.promise = this._startAsync();
    }
    return this.promise.finally(() => {
      if (!this.finished) {
        this.finish(
          createResult({
            code: 1,
            stdout: '',
            stderr: 'Process terminated unexpectedly',
            stdin: '',
          })
        );
      }
      if (onFinally) {
        onFinally();
      }
    });
  };
}
