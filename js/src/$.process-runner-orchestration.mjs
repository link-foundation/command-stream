// ProcessRunner orchestration methods - sequence, subshell, simple command, and pipe
// Part of the modular ProcessRunner architecture

import { trace } from './$.trace.mjs';
import { effectiveCwd, effectiveEnv } from './$.process-context.mjs';

/**
 * Safely get the current working directory.
 *
 * `process.cwd()` throws "getcwd() failed" when the current directory has been
 * deleted or becomes inaccessible (common in CI/CD with temporary directories).
 * This helper returns null instead of throwing so callers can fall back to a
 * safe location.
 *
 * @returns {string|null} The current working directory, or null if unavailable
 */
function safeCwd() {
  try {
    return process.cwd();
  } catch (e) {
    trace('ProcessRunner', () => `process.cwd() failed: ${e.message}`);
    return null;
  }
}

/**
 * Execute a command based on its type
 * @param {object} runner - The ProcessRunner instance
 * @param {object} command - Command to execute
 * @returns {Promise<object>} Command result
 */
function executeCommand(runner, command) {
  if (command.type === 'subshell') {
    return runner._runSubshell(command);
  } else if (command.type === 'pipeline') {
    return runner._runPipeline(command.commands);
  } else if (command.type === 'sequence') {
    return runner._runSequence(command);
  } else if (command.type === 'simple') {
    return runner._runSimpleCommand(command);
  }
  return Promise.resolve({ code: 0, stdout: '', stderr: '' });
}

function attachQuietMethod(ProcessRunner) {
  ProcessRunner.prototype.quiet = function () {
    trace('ProcessRunner', () => `quiet() called - disabling console output`);
    this.options.mirror = false;
    return this;
  };
}

function attachSubshellMethod(ProcessRunner) {
  ProcessRunner.prototype._runSubshell = async function (subshell) {
    trace(
      'ProcessRunner',
      () =>
        `_runSubshell ENTER | ${JSON.stringify({ commandType: subshell.command.type }, null, 2)}`
    );
    const savedEffectiveCwd = this._effectiveCwd;
    const savedEffectiveEnv = this._effectiveEnv;
    try {
      return await executeCommand(this, subshell.command);
    } finally {
      this._effectiveCwd = savedEffectiveCwd;
      this._effectiveEnv = savedEffectiveEnv;
    }
  };
}

/**
 * Handle file redirections for virtual command output
 * @param {object} result - Command result
 * @param {Array} redirects - Redirect specifications
 */
async function handleRedirects(result, redirects, cwd) {
  if (!redirects || redirects.length === 0) {
    return;
  }
  for (const redirect of redirects) {
    if (redirect.type === '>' || redirect.type === '>>') {
      const fs = await import('fs');
      const path = await import('path');
      const target = cwd ? path.resolve(cwd, redirect.target) : redirect.target;
      if (redirect.type === '>') {
        fs.writeFileSync(target, result.stdout);
      } else {
        fs.appendFileSync(target, result.stdout);
      }
      result.stdout = '';
    }
  }
}

/**
 * Build command string from parsed command parts
 * @param {string} cmd - Command name
 * @param {Array} args - Command arguments
 * @param {Array} redirects - Redirect specifications
 * @returns {string} Assembled command string
 */
function buildCommandString(cmd, args, redirects) {
  let commandStr = cmd;
  for (const arg of args) {
    if (arg.quoted && arg.quoteChar) {
      commandStr += ` ${arg.quoteChar}${arg.value}${arg.quoteChar}`;
    } else if (arg.value !== undefined) {
      commandStr += ` ${arg.value}`;
    } else {
      commandStr += ` ${arg}`;
    }
  }
  if (redirects) {
    for (const redirect of redirects) {
      commandStr += ` ${redirect.type} ${redirect.target}`;
    }
  }
  return commandStr;
}

/**
 * Attach orchestration methods to ProcessRunner prototype
 * @param {Function} ProcessRunner - The ProcessRunner class
 * @param {Object} deps - Dependencies
 */
export function attachOrchestrationMethods(ProcessRunner, deps) {
  const { virtualCommands, isVirtualCommandsEnabled } = deps;

  attachQuietMethod(ProcessRunner);
  attachSubshellMethod(ProcessRunner);

  ProcessRunner.prototype._runSequence = async function (sequence) {
    trace(
      'ProcessRunner',
      () =>
        `_runSequence ENTER | ${JSON.stringify({ commandCount: sequence.commands.length, operators: sequence.operators }, null, 2)}`
    );

    let lastResult = { code: 0, stdout: '', stderr: '' };
    let combinedStdout = '';
    let combinedStderr = '';

    for (let i = 0; i < sequence.commands.length; i++) {
      if (this._cancelled) {
        break;
      }

      const command = sequence.commands[i];
      const operator = i > 0 ? sequence.operators[i - 1] : null;

      trace(
        'ProcessRunner',
        () =>
          `Executing command ${i} | ${JSON.stringify({ command: command.type, operator, lastCode: lastResult.code }, null, 2)}`
      );

      if (operator === '&&' && lastResult.code !== 0) {
        trace(
          'ProcessRunner',
          () => `Skipping due to && with exit code ${lastResult.code}`
        );
        continue;
      }
      if (operator === '||' && lastResult.code === 0) {
        trace(
          'ProcessRunner',
          () => `Skipping due to || with exit code ${lastResult.code}`
        );
        continue;
      }

      lastResult = await executeCommand(this, command);
      combinedStdout += lastResult.stdout;
      combinedStderr += lastResult.stderr;
    }

    return {
      code: lastResult.code,
      stdout: combinedStdout,
      stderr: combinedStderr,
      text() {
        return Promise.resolve(combinedStdout);
      },
    };
  };

  ProcessRunner.prototype._runSimpleCommand = async function (command) {
    trace(
      'ProcessRunner',
      () =>
        `_runSimpleCommand ENTER | ${JSON.stringify({ cmd: command.cmd, argsCount: command.args?.length || 0, hasRedirects: !!command.redirects }, null, 2)}`
    );

    const { cmd, args, redirects } = command;

    if (isVirtualCommandsEnabled() && virtualCommands.has(cmd)) {
      trace('ProcessRunner', () => `Using virtual command: ${cmd}`);
      const argValues = args.map((a) => a.value || a);
      const result = await this._runVirtual(cmd, argValues, null, false);
      await handleRedirects(result, redirects, effectiveCwd(this));
      return result;
    }

    const commandStr = buildCommandString(cmd, args, redirects);
    trace('ProcessRunner', () => `Executing real command: ${commandStr}`);

    const ProcessRunnerRef = this.constructor;
    // Fall back to the inherited cwd (or undefined) when getcwd() fails so the
    // command still runs instead of crashing with "getcwd() failed".
    const currentCwd = effectiveCwd(this) ?? safeCwd();
    const runner = new ProcessRunnerRef(
      { mode: 'shell', command: commandStr },
      {
        ...this.options,
        cwd: currentCwd,
        env: effectiveEnv(this),
        _bypassVirtual: true,
      }
    );

    const forwardData = (chunk) => {
      if (!this._cancelled && !this.finished) {
        this._emitProcessedData(chunk.type, chunk.data);
      }
    };

    runner.on('data', forwardData);
    this._activeNestedRunner = runner;

    try {
      return await runner;
    } finally {
      runner.off('data', forwardData);
      if (this._activeNestedRunner === runner) {
        this._activeNestedRunner = null;
      }
    }
  };

  ProcessRunner.prototype.pipe = function (destination) {
    trace(
      'ProcessRunner',
      () =>
        `pipe ENTER | ${JSON.stringify({ hasDestination: !!destination, destinationType: destination?.constructor?.name }, null, 2)}`
    );

    const ProcessRunnerRef = this.constructor;

    if (destination instanceof ProcessRunnerRef) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: pipe => PROCESS_RUNNER_DEST | ${JSON.stringify({}, null, 2)}`
      );
      const pipeSpec = { mode: 'pipeline', source: this, destination };
      const pipeRunner = new ProcessRunnerRef(pipeSpec, {
        ...this.options,
        capture: destination.options.capture ?? true,
      });
      trace(
        'ProcessRunner',
        () => `pipe EXIT | ${JSON.stringify({ mode: 'pipeline' }, null, 2)}`
      );
      return pipeRunner;
    }

    if (destination && destination.spec) {
      trace(
        'ProcessRunner',
        () =>
          `BRANCH: pipe => TEMPLATE_LITERAL_DEST | ${JSON.stringify({}, null, 2)}`
      );
      const destRunner = new ProcessRunnerRef(
        destination.spec,
        destination.options
      );
      return this.pipe(destRunner);
    }

    trace(
      'ProcessRunner',
      () => `BRANCH: pipe => INVALID_DEST | ${JSON.stringify({}, null, 2)}`
    );
    throw new Error(
      'pipe() destination must be a ProcessRunner or $`command` result'
    );
  };
}
