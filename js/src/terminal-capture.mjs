import {
  readAsciicast,
  unrollTerminalFrames,
  writeTerminalArtifacts,
} from './terminal-artifacts.mjs';
import { spawnTerminalPty } from './terminal-pty.mjs';

const KEY_SEQUENCES = {
  BACKSPACE: '\u007f',
  CTRL_C: '\u0003',
  CTRL_D: '\u0004',
  DOWN: '\u001b[B',
  ENTER: '\r',
  ESCAPE: '\u001b',
  LEFT: '\u001b[D',
  RIGHT: '\u001b[C',
  TAB: '\t',
  UP: '\u001b[A',
};
const ERASE_SCREEN = '\u001b[2J';

const splitRenderSegments = (data) => {
  const pieces = data.split(ERASE_SCREEN);
  if (pieces.length === 1) {
    return [data];
  }

  const segments = pieces.slice(1).map((piece) => `${ERASE_SCREEN}${piece}`);
  if (pieces[0]) {
    segments.unshift(pieces[0]);
  }
  return segments;
};

const splitPendingRenderSequence = (data, flush) => {
  if (!data || flush) {
    return [data, ''];
  }
  const maximum = Math.min(data.length, ERASE_SCREEN.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (ERASE_SCREEN.startsWith(data.slice(-length))) {
      return [data.slice(0, -length), data.slice(-length)];
    }
  }
  return [data, ''];
};

const createTerminalOutputWriter = (terminal, appendFrame) => {
  let promise = Promise.resolve();
  let pending = '';
  let terminalHasOutput = false;
  const after = (operation) => {
    promise = promise.then(operation);
    return promise;
  };
  const write = (data, flush = false) => {
    const [complete, nextPending] = splitPendingRenderSequence(
      pending + data,
      flush
    );
    pending = nextPending;
    if (!complete) {
      return;
    }

    const segments = splitRenderSegments(complete);
    if (terminalHasOutput && complete.startsWith(ERASE_SCREEN)) {
      after(appendFrame);
    }
    for (const [index, segment] of segments.entries()) {
      after(
        () =>
          new Promise((written) => {
            terminal.write(segment, written);
          })
      );
      terminalHasOutput ||= segment.length > 0;
      if (index < segments.length - 1) {
        after(appendFrame);
      }
    }
  };
  return {
    after,
    flush: () => write('', true),
    settled: () => promise,
    write,
  };
};

const normalizeLines = (lines) => {
  let last = lines.length;
  while (last > 0 && lines[last - 1] === '') {
    last -= 1;
  }
  return lines.slice(0, last);
};

const ANSI_COLORS = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
];

const paletteColor = (index) => {
  if (index < ANSI_COLORS.length) {
    return ANSI_COLORS[index];
  }
  if (index < 232) {
    const offset = index - 16;
    const component = (value) => (value === 0 ? 0 : value * 40 + 55);
    return `#${[
      component(Math.floor(offset / 36)),
      component(Math.floor((offset % 36) / 6)),
      component(offset % 6),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  const gray = (index - 232) * 10 + 8;
  return `#${gray.toString(16).padStart(2, '0').repeat(3)}`;
};

const terminalColor = (cell, foreground) => {
  const isDefault = foreground ? cell.isFgDefault() : cell.isBgDefault();
  if (isDefault) {
    return null;
  }
  const value = foreground ? cell.getFgColor() : cell.getBgColor();
  const isRgb = foreground ? cell.isFgRGB() : cell.isBgRGB();
  return isRgb
    ? `#${value.toString(16).padStart(6, '0')}`
    : paletteColor(value);
};

const terminalCells = (line, columns) =>
  Array.from({ length: columns }, (_, column) => {
    const cell = line?.getCell(column);
    if (!cell) {
      return { chars: ' ', width: 1 };
    }
    return {
      chars: cell.getChars() || ' ',
      width: cell.getWidth(),
      fg: terminalColor(cell, true),
      bg: terminalColor(cell, false),
      bold: Boolean(cell.isBold()),
      dim: Boolean(cell.isDim()),
      italic: Boolean(cell.isItalic()),
      underline: Boolean(cell.isUnderline()),
      reverse: Boolean(cell.isInverse()),
      strikethrough: Boolean(cell.isStrikethrough()),
      invisible: Boolean(cell.isInvisible()),
    };
  });

const terminalFrame = (terminal, elapsed) => {
  const buffer = terminal.buffer.active;
  const allLines = Array.from(
    { length: buffer.length },
    (_, index) => buffer.getLine(index)?.translateToString(true).trimEnd() ?? ''
  );
  const screen = Array.from(
    { length: terminal.rows },
    (_, index) =>
      buffer
        .getLine(buffer.viewportY + index)
        ?.translateToString(true)
        .trimEnd() ?? ''
  );
  const cells = Array.from({ length: terminal.rows }, (_, index) =>
    terminalCells(buffer.getLine(buffer.viewportY + index), terminal.cols)
  );
  return {
    time: elapsed(),
    cols: terminal.cols,
    rows: terminal.rows,
    cursor: {
      x: buffer.cursorX,
      y: buffer.cursorY,
    },
    alternate: buffer === terminal.buffer.alternate,
    lines: normalizeLines(allLines),
    screen: normalizeLines(screen),
    cells,
  };
};

const sameFrame = (left, right) =>
  left.cols === right.cols &&
  left.rows === right.rows &&
  left.cursor.x === right.cursor.x &&
  left.cursor.y === right.cursor.y &&
  left.alternate === right.alternate &&
  left.lines.length === right.lines.length &&
  left.lines.every((line, index) => line === right.lines[index]) &&
  JSON.stringify(left.cells) === JSON.stringify(right.cells);

const runtimeDependencies = async () => {
  const xtermModule = await import('@xterm/headless');
  return {
    Terminal: (xtermModule.default ?? xtermModule).Terminal,
  };
};

const captureEnvironment = (environment) =>
  Object.fromEntries(
    Object.entries(environment)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, String(value)])
  );

const createAsciicast = ({ cols, rows, file, environment }) => ({
  header: {
    version: 2,
    width: cols,
    height: rows,
    timestamp: Math.floor(Date.now() / 1000),
    env: {
      SHELL: file,
      TERM: environment.TERM,
    },
  },
  events: [],
});

const createCaptureRecorder = (asciicast, onTrace) => {
  const startedAt = Date.now();
  const elapsed = () => Number(((Date.now() - startedAt) / 1000).toFixed(6));
  return {
    elapsed,
    record: (code, data) => {
      asciicast.events.push({ time: elapsed(), code, data });
    },
    trace: (type, details = {}) => {
      onTrace?.({ time: elapsed(), type, ...details });
    },
  };
};

const matchesOutput = (pattern, output) => {
  if (pattern === undefined) {
    return true;
  }
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(output);
  }
  return output.includes(pattern);
};

const interactionAfter = (interaction, output) =>
  matchesOutput(interaction.after, output);

const applyInteraction = ({ interaction, process, terminal, record }) => {
  if (interaction.text !== undefined) {
    const text = String(interaction.text);
    process.write(text);
    record('i', text);
  }
  if (interaction.key !== undefined) {
    const sequence = KEY_SEQUENCES[interaction.key] ?? interaction.key;
    process.write(sequence);
    record('i', sequence);
  }
  if (interaction.resize !== undefined) {
    const { cols, rows } = interaction.resize;
    process.resize(cols, rows);
    terminal.resize(cols, rows);
    record('r', `${cols}x${rows}`);
  }
};

const createInteractionCoordinator = ({
  interactions,
  output,
  outputWriter,
  appendFrame,
  trace,
  process,
  terminal,
  record,
}) => {
  let index = 0;
  let timer;
  let scheduled = false;
  const applyNext = () => {
    scheduled = true;
    trace('interaction-scheduled', { interactionIndex: index });
    outputWriter.after(() => {
      appendFrame();
      trace('interaction-applied', { interactionIndex: index });
      applyInteraction({
        interaction: interactions[index],
        process,
        terminal,
        record,
      });
      index += 1;
      scheduled = false;
      advance();
    });
  };
  const advance = () => {
    if (
      scheduled ||
      index >= interactions.length ||
      !interactionAfter(interactions[index], output())
    ) {
      return;
    }
    const idleMilliseconds = interactions[index].idleMilliseconds ?? 0;
    if (idleMilliseconds > 0) {
      scheduled = true;
      timer = setTimeout(() => {
        timer = undefined;
        scheduled = false;
        applyNext();
      }, idleMilliseconds);
      return;
    }
    applyNext();
  };
  return {
    advance,
    close: () => clearTimeout(timer),
    count: () => index,
    outputArrived: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        scheduled = false;
      }
    },
  };
};

const startTerminal = async ({ file, args, cwd, env, cols, rows }) => {
  const { Terminal } = await runtimeDependencies();
  const environment = captureEnvironment({
    ...env,
    TERM: env.TERM ?? 'xterm-256color',
  });
  const terminal = new Terminal({
    cols,
    rows,
    scrollback: 100_000,
    allowProposedApi: true,
  });
  const child = await spawnTerminalPty(file, args.map(String), {
    name: environment.TERM,
    cols,
    rows,
    cwd,
    env: environment,
  });
  return { child, environment, terminal };
};

const captureResult = ({
  status,
  output,
  transcript,
  frames,
  interactionCount,
  asciicast,
}) => ({
  ...status,
  output,
  transcript,
  frames,
  interactionCount,
  asciicast,
});

const persistArtifacts = async ({
  artifactDirectory,
  frames,
  transcript,
  asciicast,
  artifactOptions,
}) => {
  if (artifactDirectory) {
    await writeTerminalArtifacts({
      directory: artifactDirectory,
      frames,
      transcript,
      asciicast,
      options: artifactOptions,
    });
  }
};

const resolveTerminalRows = ({ cols, rows, aspectRatio, label }) => {
  if (!(aspectRatio > 0)) {
    throw new TypeError(`${label} aspectRatio must be greater than zero`);
  }
  return rows ?? Math.max(1, Math.round(cols / (2 * aspectRatio)));
};

const hasTimeout = (timeoutMilliseconds) =>
  typeof timeoutMilliseconds === 'number' &&
  timeoutMilliseconds > 0 &&
  Number.isFinite(timeoutMilliseconds);

const createWaiterRegistry = (output) => {
  const waiters = new Set();
  let finished = false;
  const release = (waiter) => {
    waiters.delete(waiter);
    clearTimeout(waiter.idleTimer);
    clearTimeout(waiter.deadline);
  };
  const check = () => {
    for (const waiter of [...waiters]) {
      if (!matchesOutput(waiter.pattern, output())) {
        continue;
      }
      clearTimeout(waiter.idleTimer);
      if (waiter.idleMilliseconds > 0 && !finished) {
        waiter.idleTimer = setTimeout(() => {
          release(waiter);
          waiter.resolve();
        }, waiter.idleMilliseconds);
        continue;
      }
      release(waiter);
      waiter.resolve();
    }
  };
  return {
    check,
    add: ({ pattern, idleMilliseconds = 0, timeoutMilliseconds }) =>
      new Promise((resolve, reject) => {
        const waiter = { pattern, idleMilliseconds, resolve, reject };
        if (hasTimeout(timeoutMilliseconds)) {
          waiter.deadline = setTimeout(() => {
            release(waiter);
            reject(
              new Error(
                `Terminal waitFor timed out after ${timeoutMilliseconds} ms`
              )
            );
          }, timeoutMilliseconds);
        }
        waiters.add(waiter);
        check();
      }),
    finish: (reason) => {
      finished = true;
      check();
      for (const waiter of [...waiters]) {
        release(waiter);
        waiter.reject(reason());
      }
    },
  };
};

const watchTerminal = ({
  child,
  state,
  outputWriter,
  settle,
  appendFrame,
  waiters,
  interactionCoordinator,
  record,
  trace,
  stopMarker,
  stopMarkerGraceMilliseconds,
  timeoutMilliseconds,
}) => {
  let stopTimer, timeoutTimer;
  let stopMarkerSeen = false;
  return new Promise((resolve) => {
    if (hasTimeout(timeoutMilliseconds)) {
      timeoutTimer = setTimeout(() => {
        state.error = new Error(
          `Terminal command timed out after ${timeoutMilliseconds} ms`
        );
        trace('timeout', { timeoutMilliseconds });
        child.kill('SIGTERM');
      }, timeoutMilliseconds);
    }

    child.onData((data) => {
      interactionCoordinator.outputArrived();
      trace('output', { data });
      state.output += data;
      record('o', data);
      outputWriter.write(data);
      outputWriter.after(settle);
      interactionCoordinator.advance();
      waiters.check();

      if (stopMarker && state.output.includes(stopMarker) && !stopMarkerSeen) {
        stopMarkerSeen = true;
        outputWriter.after(appendFrame);
        stopTimer = setTimeout(
          () => child.kill('SIGTERM'),
          stopMarkerGraceMilliseconds
        );
      }
    });
    child.onExit(({ exitCode, signal, error }) => {
      trace('exit', { exitCode, signal });
      clearTimeout(timeoutTimer);
      clearTimeout(stopTimer);
      interactionCoordinator.close();
      state.error ??= error;
      state.exitStatus = { exitCode, signal };
      waiters.finish(
        () =>
          state.error ??
          new Error(
            `Terminal exited with code ${exitCode} before the expected output arrived`
          )
      );
      resolve(state.exitStatus);
    });
  });
};

const createTerminalSessionApi = ({
  child,
  terminal,
  state,
  frames,
  asciicast,
  outputWriter,
  waiters,
  interactionCoordinator,
  record,
  elapsed,
  appendFrame,
  clearSettle,
  markDisposed,
  isDisposed,
  completion,
  artifactDirectory,
  artifactOptions,
}) => {
  let finalized;

  const drain = async () => {
    outputWriter.flush();
    await outputWriter.settled();
  };

  const finalize = () => {
    finalized ??= (async () => {
      const status = await completion;
      try {
        await drain();
        clearSettle();
        appendFrame();
      } finally {
        markDisposed();
        terminal.dispose();
      }

      const transcript = unrollTerminalFrames(frames);
      await persistArtifacts({
        artifactDirectory,
        frames,
        transcript,
        asciicast,
        artifactOptions,
      });

      return captureResult({
        status,
        output: state.output,
        transcript,
        frames,
        interactionCount: interactionCoordinator.count(),
        asciicast,
      });
    })();
    return finalized;
  };

  const finished = async () => {
    const capture = await finalize();
    if (state.error) {
      state.error.capture = capture;
      throw state.error;
    }
    return capture;
  };

  const currentTranscript = () => {
    if (isDisposed()) {
      return unrollTerminalFrames(frames);
    }
    const frame = terminalFrame(terminal, elapsed);
    const known = frames.at(-1);
    return unrollTerminalFrames(
      known && sameFrame(known, frame) ? frames : [...frames, frame]
    );
  };

  const waitFor = async (pattern, options = {}) => {
    await waiters.add({ pattern, ...options });
    await drain();
    return currentTranscript();
  };

  const send = async (input) => {
    for (const interaction of Array.isArray(input) ? input : [input]) {
      if (interaction.after !== undefined || interaction.idleMilliseconds) {
        await waitFor(interaction.after, {
          idleMilliseconds: interaction.idleMilliseconds,
          timeoutMilliseconds: interaction.timeoutMilliseconds,
        });
      }
      if (state.exitStatus) {
        throw new Error('Terminal session has already exited');
      }
      await outputWriter.after(() => {
        appendFrame();
        applyInteraction({ interaction, process: child, terminal, record });
      });
    }
    return currentTranscript();
  };

  const stop = async ({
    signal = 'SIGTERM',
    timeoutMilliseconds: killTimeout = 5_000,
  } = {}) => {
    if (!state.exitStatus) {
      child.kill(signal);
      const stopped = await Promise.race([
        completion.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), killTimeout)),
      ]);
      if (!stopped) {
        child.kill('SIGKILL');
      }
    }
    return finalize();
  };

  return {
    get output() {
      return state.output;
    },
    get transcript() {
      return currentTranscript();
    },
    get frames() {
      return frames;
    },
    get asciicast() {
      return asciicast;
    },
    get exitStatus() {
      return state.exitStatus;
    },
    get running() {
      return state.exitStatus === undefined;
    },
    process: child,
    terminal,
    exited: completion,
    waitFor,
    send,
    finished,
    close: stop,
    dispose: async (options) => {
      try {
        return await stop(options);
      } catch {
        return undefined;
      }
    },
  };
};

/**
 * Open a pseudoterminal session that stays alive until the caller closes it.
 *
 * Unlike `captureTerminal`, input may be sent at any later point through
 * `session.send()`, and readiness can be awaited with `session.waitFor()`.
 */
export const openTerminal = async ({
  file,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  cols = 80,
  rows,
  aspectRatio = 4 / 3,
  settleMilliseconds = 35,
  interactions = [],
  stopMarker,
  stopMarkerGraceMilliseconds = 250,
  timeoutMilliseconds,
  artifactDirectory,
  artifactOptions,
  onTrace,
  label = 'openTerminal',
} = {}) => {
  if (!file) {
    throw new TypeError(`${label} requires a file`);
  }
  const terminalRows = resolveTerminalRows({ cols, rows, aspectRatio, label });

  const { child, environment, terminal } = await startTerminal({
    file,
    args,
    cwd,
    env,
    cols,
    rows: terminalRows,
  });
  const asciicast = createAsciicast({
    cols,
    rows: terminalRows,
    file,
    environment,
  });
  const {
    elapsed,
    record,
    trace: traceCapture,
  } = createCaptureRecorder(asciicast, onTrace);
  const frames = [];
  const state = { output: '', error: undefined, exitStatus: undefined };
  let settleTimer;
  let disposed = false;
  const appendFrame = () => {
    if (disposed) {
      return;
    }
    const frame = terminalFrame(terminal, elapsed);
    if (!frames.at(-1) || !sameFrame(frames.at(-1), frame)) {
      frames.push(frame);
    }
  };
  const settle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(appendFrame, settleMilliseconds);
  };
  const outputWriter = createTerminalOutputWriter(terminal, appendFrame);
  const waiters = createWaiterRegistry(() => state.output);
  const interactionCoordinator = createInteractionCoordinator({
    interactions,
    output: () => state.output,
    outputWriter,
    appendFrame,
    trace: traceCapture,
    process: child,
    terminal,
    record,
  });

  const completion = watchTerminal({
    child,
    state,
    outputWriter,
    settle,
    appendFrame,
    waiters,
    interactionCoordinator,
    record,
    trace: traceCapture,
    stopMarker,
    stopMarkerGraceMilliseconds,
    timeoutMilliseconds,
  });

  return createTerminalSessionApi({
    child,
    terminal,
    state,
    frames,
    asciicast,
    outputWriter,
    waiters,
    interactionCoordinator,
    record,
    elapsed,
    appendFrame,
    clearSettle: () => clearTimeout(settleTimer),
    markDisposed: () => {
      disposed = true;
    },
    isDisposed: () => disposed,
    completion,
    artifactDirectory,
    artifactOptions,
  });
};

/**
 * Run a command inside a real pseudoterminal and retain its settled TUI states.
 */
export const captureTerminal = async (options = {}) => {
  const session = await openTerminal({
    ...options,
    timeoutMilliseconds: options.timeoutMilliseconds ?? 30_000,
    label: 'captureTerminal',
  });
  return session.finished();
};

export { readAsciicast, unrollTerminalFrames };
