import { performance } from 'node:perf_hooks';
import xterm from '@xterm/headless';
import { EventEmitter } from 'node:events';
import { terminalFrame, sameFrame } from './terminal-capture.mjs';

function dimensions(cols, rows) {
  if (
    ![cols, rows].every((n) => Number.isSafeInteger(n) && n > 0) ||
    cols * rows > 1_000_000
  ) {
    throw new RangeError(
      'Terminal dimensions must be positive and at most 1,000,000 cells'
    );
  }
}

function coloredLine(cells, length) {
  let text = '';
  let offset = 0;
  for (const cell of cells) {
    if (offset >= length) {
      break;
    }
    if (!cell.width) {
      continue;
    }
    const codes = [];
    for (const [attribute, code] of [
      ['bold', 1],
      ['dim', 2],
      ['italic', 3],
      ['underline', 4],
      ['reverse', 7],
      ['invisible', 8],
      ['strikethrough', 9],
    ]) {
      if (cell[attribute]) {
        codes.push(code);
      }
    }
    for (const [color, code] of [
      ['fg', 38],
      ['bg', 48],
    ]) {
      if (cell[color]) {
        codes.push(
          `${code};2;${cell[color]
            .slice(1)
            .match(/../g)
            .map((hex) => parseInt(hex, 16))
            .join(';')}`
        );
      }
    }
    text += codes.length
      ? `\x1b[${codes.join(';')}m${cell.chars}\x1b[0m`
      : cell.chars;
    offset += cell.chars.length;
  }
  return text;
}

/** Writable emulator with coalesced frame events and demand-driven text snapshots. */
export class TerminalBuffer extends EventEmitter {
  constructor({
    cols = 80,
    rows = 24,
    scrollback = 1000,
    frameInterval = 16,
  } = {}) {
    super();
    dimensions(cols, rows);
    if (
      !Number.isSafeInteger(scrollback) ||
      scrollback < 0 ||
      scrollback * cols > 1_000_000 ||
      !Number.isFinite(frameInterval) ||
      frameInterval < 0
    ) {
      throw new RangeError('Invalid scrollback or frame interval');
    }
    this.terminal = new xterm.Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
    this.frameInterval = frameInterval;
    this.started = performance.now();
    this.pending = Promise.resolve();
    this.previous = this.snapshot();
    this.disposed = false;
  }
  snapshot() {
    return terminalFrame(
      this.terminal,
      () => (performance.now() - this.started) / 1000
    );
  }
  text({ color = false } = {}) {
    const frame = this.snapshot();
    return frame.screen
      .map((line, index) =>
        color ? coloredLine(frame.cells[index], line.length) : line
      )
      .join('\n');
  }
  write(data) {
    if (this.disposed) {
      return Promise.reject(new Error('Terminal buffer is disposed'));
    }
    this.pending = this.pending.then(
      () =>
        new Promise((resolve, reject) => {
          if (this.disposed) {
            reject(new Error('Terminal buffer is disposed'));
            return;
          }
          const closed = () => reject(new Error('Terminal buffer is disposed'));
          this.once('dispose', closed);
          this.terminal.write(data, () => {
            this.off('dispose', closed);
            resolve();
          });
        })
    );
    return this.pending.then(() => this.schedule());
  }
  resize(cols, rows) {
    dimensions(cols, rows);
    if (this.terminal.options.scrollback * cols > 1_000_000) {
      throw new RangeError('Resized scrollback exceeds 1,000,000 cells');
    }
    if (this.disposed) {
      throw new Error('Terminal buffer is disposed');
    }
    this.terminal.resize(cols, rows);
    this.schedule();
  }
  schedule() {
    if (this.disposed || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.publish();
    }, this.frameInterval);
    this.timer.unref?.();
  }
  publish() {
    if (this.disposed) {
      return;
    }
    const frame = this.snapshot();
    if (!sameFrame(this.previous, frame)) {
      this.previous = frame;
      this.emit('frame', frame);
    }
  }
  async flush() {
    await this.pending;
    clearTimeout(this.timer);
    this.timer = null;
    this.publish();
  }
  async *frames() {
    let latest;
    let wake;
    const listener = (frame) => {
      latest = frame;
      wake?.();
    };
    const close = () => wake?.();
    this.on('frame', listener);
    this.on('dispose', close);
    try {
      while (!this.disposed) {
        if (!latest) {
          await new Promise((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
        if (latest) {
          const frame = latest;
          latest = null;
          yield frame;
        }
      }
    } finally {
      this.off('frame', listener);
      this.off('dispose', close);
    }
  }
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.timer);
    this.emit('dispose');
    this.removeAllListeners();
    this.terminal.dispose();
  }
}
