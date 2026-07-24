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
const CLEAR_SCREEN = '\u001b[2J\u001b[H';

const splitRenderSegments = (data) => {
  const pieces = data.split(CLEAR_SCREEN);
  if (pieces.length === 1) {
    return [data];
  }

  const segments = pieces.slice(1).map((piece) => `${CLEAR_SCREEN}${piece}`);
  if (pieces[0]) {
    segments.unshift(pieces[0]);
  }
  return segments;
};

const normalizeLines = (lines) => {
  let last = lines.length;
  while (last > 0 && lines[last - 1] === '') {
    last -= 1;
  }
  return lines.slice(0, last);
};

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
  };
};

const sameFrame = (left, right) =>
  left.cols === right.cols &&
  left.rows === right.rows &&
  left.cursor.x === right.cursor.x &&
  left.cursor.y === right.cursor.y &&
  left.alternate === right.alternate &&
  left.lines.length === right.lines.length &&
  left.lines.every((line, index) => line === right.lines[index]);

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

const interactionAfter = (interaction, output) =>
  interaction.after === undefined || output.includes(interaction.after);

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
}) => {
  if (artifactDirectory) {
    await writeTerminalArtifacts({
      directory: artifactDirectory,
      frames,
      transcript,
      asciicast,
    });
  }
};

/**
 * Run a command inside a real pseudoterminal and retain its settled TUI states.
 */
export const captureTerminal = async ({
  file,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  cols = 80,
  rows = 24,
  settleMilliseconds = 35,
  interactions = [],
  stopMarker,
  stopMarkerGraceMilliseconds = 250,
  timeoutMilliseconds = 30_000,
  artifactDirectory,
  onTrace,
} = {}) => {
  if (!file) {
    throw new TypeError('captureTerminal requires a file');
  }

  const { child, environment, terminal } = await startTerminal({
    file,
    args,
    cwd,
    env,
    cols,
    rows,
  });
  const asciicast = createAsciicast({ cols, rows, file, environment });
  const {
    elapsed,
    record,
    trace: traceCapture,
  } = createCaptureRecorder(asciicast, onTrace);
  const frames = [];
  let output = '';
  let interactionIndex = 0;
  let settleTimer, stopTimer;
  let stopMarkerSeen = false;
  let writeQueue = Promise.resolve();
  let terminalHasOutput = false;
  let interactionScheduled = false;
  let captureError;
  const appendFrame = () => {
    const frame = terminalFrame(terminal, elapsed);
    if (!frames.at(-1) || !sameFrame(frames.at(-1), frame)) {
      frames.push(frame);
    }
  };
  const settle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(appendFrame, settleMilliseconds);
  };
  const queueOutput = (data) => {
    const segments = splitRenderSegments(data);
    if (terminalHasOutput && data.startsWith(CLEAR_SCREEN)) {
      writeQueue = writeQueue.then(appendFrame);
    }
    for (const [index, segment] of segments.entries()) {
      writeQueue = writeQueue.then(
        () =>
          new Promise((written) => {
            terminal.write(segment, written);
          })
      );
      terminalHasOutput ||= segment.length > 0;
      if (index < segments.length - 1) {
        writeQueue = writeQueue.then(appendFrame);
      }
    }
  };
  const advanceInteractions = () => {
    if (
      interactionScheduled ||
      interactionIndex >= interactions.length ||
      !interactionAfter(interactions[interactionIndex], output)
    ) {
      return;
    }

    interactionScheduled = true;
    traceCapture('interaction-scheduled', { interactionIndex });
    writeQueue.then(() => {
      appendFrame();
      traceCapture('interaction-applied', { interactionIndex });
      applyInteraction({
        interaction: interactions[interactionIndex],
        process: child,
        terminal,
        record,
      });
      interactionIndex += 1;
      interactionScheduled = false;
      advanceInteractions();
    });
  };

  const completion = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      captureError = new Error(
        `Terminal command timed out after ${timeoutMilliseconds} ms`
      );
      traceCapture('timeout', { timeoutMilliseconds });
      child.kill('SIGTERM');
    }, timeoutMilliseconds);

    child.onData((data) => {
      traceCapture('output', { data });
      output += data;
      record('o', data);
      queueOutput(data);
      writeQueue.then(settle);
      advanceInteractions();

      if (stopMarker && output.includes(stopMarker) && !stopMarkerSeen) {
        stopMarkerSeen = true;
        writeQueue.then(appendFrame);
        stopTimer = setTimeout(
          () => child.kill('SIGTERM'),
          stopMarkerGraceMilliseconds
        );
      }
    });
    child.onExit(({ exitCode, signal, error }) => {
      traceCapture('exit', { exitCode, signal });
      clearTimeout(timeout);
      clearTimeout(stopTimer);
      captureError ??= error;
      resolve({ exitCode, signal });
    });
  });

  let status;
  try {
    status = await completion;
    await writeQueue;
    clearTimeout(settleTimer);
    appendFrame();
  } finally {
    terminal.dispose();
  }

  const transcript = unrollTerminalFrames(frames);
  await persistArtifacts({ artifactDirectory, frames, transcript, asciicast });

  const capture = captureResult({
    status,
    output,
    transcript,
    frames,
    interactionCount: interactionIndex,
    asciicast,
  });
  if (captureError) {
    captureError.capture = capture;
    throw captureError;
  }
  return capture;
};

export { readAsciicast, unrollTerminalFrames };
