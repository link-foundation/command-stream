import { performance } from 'node:perf_hooks';
import xterm from '@xterm/headless';
import { EventEmitter } from 'node:events';
import { terminalFrame, sameFrame } from './terminal-capture.mjs';
import {
  terminalChange,
  terminalDimensions,
  terminalEventStream,
} from './terminal-events.mjs';

import { terminalText } from './terminal-text.mjs';

/** Writable emulator with coalesced frame events and demand-driven text snapshots. */
export class TerminalBuffer extends EventEmitter {
  constructor({
    cols = 80,
    rows = 24,
    scrollback = 1000,
    frameInterval = 16,
  } = {}) {
    super();
    terminalDimensions(cols, rows);
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
    this.sequence = 0;
    this.terminal.onData((data) => this.emit('input', data));
  }
  snapshot() {
    return terminalFrame(
      this.terminal,
      () => (performance.now() - this.started) / 1000
    );
  }
  text({ color = false } = {}) {
    return terminalText(this.snapshot(), { color });
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
    terminalDimensions(cols, rows);
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
    if (this.frameInterval === 0) {
      this.publish();
      return;
    }
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
      const change = terminalChange(this.previous, frame, ++this.sequence);
      this.previous = frame;
      this.emit('frame', frame);
      this.emit('change', change);
    }
  }
  async flush() {
    await this.pending;
    clearTimeout(this.timer);
    this.timer = null;
    this.publish();
  }
  frames(options) {
    return terminalEventStream(this, 'frame', options);
  }
  changes(options) {
    return terminalEventStream(this, 'change', options);
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
