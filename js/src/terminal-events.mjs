import { terminalText } from './terminal-text.mjs';

export function terminalSubscriptions(events, snapshot) {
  const subscribe = (event, listener) => {
    events.on(event, listener);
    return () => events.off(event, listener);
  };
  return {
    snapshot,
    text: (options) => terminalText(snapshot(), options),
    onFrame: (listener) => subscribe('frame', listener),
    onChange: (listener) => subscribe('change', listener),
    frameStream: (options) => terminalEventStream(events, 'frame', options),
    changes: (options) => terminalEventStream(events, 'change', options),
  };
}

export function validateFrameMode(frameMode) {
  if (!['settled', 'writes'].includes(frameMode)) {
    throw new TypeError('Terminal frameMode must be settled or writes');
  }
}

/** Shared dimension guard for emulators and real PTYs. */
export function terminalDimensions(cols, rows) {
  if (
    ![cols, rows].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 65535
    ) ||
    cols * rows > 1_000_000
  ) {
    throw new RangeError(
      'Terminal dimensions must be positive integers, at most 65535 per axis and 1,000,000 cells'
    );
  }
}

/** Row replacements and a scrollback splice, without unchanged screen cells. */
export function terminalChange(previous, frame, sequence) {
  const reset =
    !previous ||
    previous.cols !== frame.cols ||
    previous.rows !== frame.rows ||
    previous.alternate !== frame.alternate;
  const updates = [];
  for (let y = 0; y < frame.rows; y += 1) {
    if (
      reset ||
      JSON.stringify(previous.cells[y]) !== JSON.stringify(frame.cells[y])
    ) {
      updates.push({ y, text: frame.screen[y] ?? '', cells: frame.cells[y] });
    }
  }
  const before = reset ? [] : previous.lines;
  let start = 0;
  while (
    start < before.length &&
    start < frame.lines.length &&
    before[start] === frame.lines[start]
  ) {
    start += 1;
  }
  let oldEnd = before.length;
  let newEnd = frame.lines.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === frame.lines[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return {
    sequence,
    time: frame.time,
    cols: frame.cols,
    rows: frame.rows,
    cursor: { ...frame.cursor },
    alternate: frame.alternate,
    reset,
    updates,
    history: {
      start,
      deleteCount: oldEnd - start,
      lines: frame.lines.slice(start, newEnd),
    },
  };
}

/** Bounded ordered notifications. Overflow is explicit so deltas cannot silently diverge. */
export async function* terminalEventStream(
  events,
  event,
  { capacity = 64, signal } = {}
) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError('Terminal stream capacity must be a positive integer');
  }
  const queue = [];
  let wake;
  let error;
  let closed = Boolean(events.closed || events.disposed || signal?.aborted);
  const close = () => {
    closed = true;
    wake?.();
  };
  const listener = (value) => {
    if (closed || error) {
      return;
    }
    if (queue.length >= capacity) {
      error = new Error(
        'Terminal stream overflow; subscribe again and take a new snapshot'
      );
    } else {
      queue.push(value);
    }
    wake?.();
  };
  events.on(event, listener);
  events.on('dispose', close);
  signal?.addEventListener('abort', close, { once: true });
  try {
    while (!closed || queue.length) {
      if (error) {
        throw error;
      }
      if (queue.length) {
        yield queue.shift();
      } else {
        await new Promise((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    }
    if (error) {
      throw error;
    }
  } finally {
    events.off(event, listener);
    events.off('dispose', close);
    signal?.removeEventListener('abort', close);
  }
}
