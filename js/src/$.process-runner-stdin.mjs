import { trace } from './$.trace.mjs';
import { StreamUtils } from './$.stream-utils.mjs';

async function writeChunk(sink, bytes) {
  if (typeof sink.flush === 'function') {
    sink.write(bytes);
    await sink.flush();
    return;
  }
  if (!StreamUtils.isStreamWritable(sink)) {
    return;
  }
  await new Promise((resolve, reject) =>
    sink.write(bytes, (error) => (error ? reject(error) : resolve()))
  );
}

/** Forward stdin until EOF or child exit, without destroying the shared source. */
export async function pumpInheritedStdin(child, captureChunks) {
  trace('ProcessRunner', () => '_pumpStdinTo ENTER');
  if (!child.stdin) {
    return;
  }
  StreamUtils.addStdinErrorHandler(child.stdin, 'inherited stdin');
  const source = process.stdin;
  const writer = child.stdin.getWriter?.();
  const wasFlowing = source.readableFlowing;
  let pending = Promise.resolve();
  let stopped = false;
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    source.off('data', data);
    source.off('end', stop);
    source.off('error', stop);
    child.off?.('exit', stop);
    child.off?.('close', stop);
    if (!wasFlowing) {
      source.pause();
    }
    finish();
  };
  const data = (chunk) => {
    source.pause();
    const bytes = Buffer.from(chunk);
    captureChunks?.push(bytes);
    pending = pending
      .then(async () => {
        if (writer) {
          await writer.write(bytes);
        } else {
          await writeChunk(child.stdin, bytes);
        }
      })
      .catch((error) => {
        StreamUtils.handleStreamError(error, 'inherited stdin', false);
        stop();
      })
      .finally(() => {
        if (!stopped) {
          source.resume();
        }
      });
  };
  source.on('data', data);
  source.once('end', stop);
  source.once('error', stop);
  child.once?.('exit', stop);
  child.once?.('close', stop);
  child.exited?.then(stop, stop);
  if (source.readableEnded || source.destroyed) {
    stop();
  } else {
    source.resume();
  }
  await finished;
  await pending;
  try {
    if (writer) {
      await writer.close();
    } else {
      await child.stdin.end?.();
    }
  } catch (error) {
    StreamUtils.handleStreamError(error, 'inherited stdin close', false);
  }
}
