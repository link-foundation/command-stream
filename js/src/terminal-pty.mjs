import { trace } from './$.trace.mjs';

const parseMessages = (stream, receive) => {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (line) {
        receive(JSON.parse(line));
      }
    }
  });
};

// Process exit can precede buffered status delivery. Observe pipe drain directly
// because some Bun/Windows exits do not emit the child-process close event.
const watchHostExit = (host, receive) => {
  let exitCode;
  let stdoutEnded = false;
  let stderrEnded = false;
  const drained = () => {
    if (exitCode !== undefined && stdoutEnded && stderrEnded) {
      receive(exitCode);
    }
  };
  host.on('exit', (code) => {
    trace('PTY', `host exit: ${code}`);
    exitCode = code;
    drained();
  });
  host.stdout.on('end', () => {
    trace('PTY', 'host stdout drained');
    stdoutEnded = true;
    drained();
  });
  host.stderr.on('end', () => {
    trace('PTY', 'host stderr drained');
    stderrEnded = true;
    drained();
  });
  host.on('close', (code) => {
    trace('PTY', `host close: ${code}`);
    receive(code);
  });
};

export const spawnTerminalPty = async (
  file,
  args,
  options,
  {
    hostPath: hostPathOverride,
    nodeBinary: nodeBinaryOverride,
    spawn: spawnOverride,
  } = {}
) => {
  const [{ spawn }, { dirname }, { fileURLToPath }] = await Promise.all([
    import('node:child_process'),
    import('node:path'),
    import('node:url'),
  ]);
  const hostPath =
    hostPathOverride ??
    fileURLToPath(new URL('./terminal-pty-host.mjs', import.meta.url));
  const nodeBinary =
    nodeBinaryOverride ?? process.env.COMMAND_STREAM_NODE_BINARY ?? 'node';
  const host = (spawnOverride ?? spawn)(nodeBinary, [hostPath], {
    cwd: dirname(hostPath),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const dataListeners = new Set();
  const exitListeners = new Set();
  const pendingData = [];
  let pendingExit;
  let hostErrors = '';
  let exited = false;
  let terminalExitReceived = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const send = (message) => {
    host.stdin.write(`${JSON.stringify(message)}\n`);
  };
  parseMessages(host.stdout, (message) => {
    if (message.type === 'data') {
      if (dataListeners.size === 0) {
        pendingData.push(message.data);
      } else {
        for (const listener of dataListeners) {
          listener(message.data);
        }
      }
    } else if (message.type === 'exit') {
      terminalExitReceived = true;
      if (exitListeners.size === 0) {
        pendingExit = message;
      } else {
        for (const listener of exitListeners) {
          listener(message);
        }
      }
    } else if (message.type === 'ready') {
      resolveReady();
    }
  });
  host.stderr.setEncoding('utf8');
  host.stderr.on('data', (chunk) => {
    hostErrors += chunk;
  });
  host.on('error', (error) => {
    if (!exited) {
      exited = true;
      rejectReady(error);
      const message = { exitCode: 1, signal: 0, error };
      if (exitListeners.size === 0) {
        pendingExit = message;
      } else {
        for (const listener of exitListeners) {
          listener(message);
        }
      }
    }
  });
  watchHostExit(host, (exitCode) => {
    if (!terminalExitReceived && !exited) {
      exited = true;
      const error = new Error(
        `PTY host exited with code ${exitCode}: ${hostErrors.trim()}`
      );
      rejectReady(error);
      const message = { exitCode: exitCode ?? 1, signal: 0, error };
      if (exitListeners.size === 0) {
        pendingExit = message;
      } else {
        for (const listener of exitListeners) {
          listener(message);
        }
      }
    }
  });

  send({ type: 'spawn', file, args, options });
  await ready;
  return {
    onData(listener) {
      dataListeners.add(listener);
      for (const data of pendingData.splice(0)) {
        listener(data);
      }
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (pendingExit) {
        listener(pendingExit);
        pendingExit = undefined;
      }
      return { dispose: () => exitListeners.delete(listener) };
    },
    write(data) {
      send({ type: 'input', data });
    },
    resize(cols, rows) {
      send({ type: 'resize', cols, rows });
    },
    kill(signal = 'SIGTERM') {
      send({ type: 'kill', signal });
    },
  };
};
