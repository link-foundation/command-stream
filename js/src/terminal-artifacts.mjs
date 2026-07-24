const EVENT_TYPES = {
  i: 'input',
  o: 'output',
  r: 'resize',
};

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const trimBlankEdges = (lines) => {
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first] === '') {
    first += 1;
  }
  while (last > first && lines[last - 1] === '') {
    last -= 1;
  }
  return lines.slice(first, last);
};

const overlapLength = (previous, current) => {
  const maximum = Math.min(previous.length, current.length);
  for (let size = maximum; size > 0; size -= 1) {
    if (
      previous
        .slice(previous.length - size)
        .every((line, index) => line === current[index])
    ) {
      return size;
    }
  }
  return 0;
};

/**
 * Convert settled terminal states into a readable, chronological transcript.
 *
 * Prefixes and suffixes already present in the immediately preceding state are
 * collapsed. Content that appears again after another state is retained.
 */
export const unrollTerminalFrames = (frames) => {
  const transcript = [];
  let previous = [];

  for (const frame of frames) {
    const current = trimBlankEdges(frame.lines);
    if (
      current.length === previous.length &&
      current.every((line, index) => line === previous[index])
    ) {
      continue;
    }

    const overlap = overlapLength(previous, current);
    if (overlap > 0) {
      transcript.push(...current.slice(overlap));
    } else {
      let commonPrefix = 0;
      while (
        commonPrefix < previous.length &&
        commonPrefix < current.length &&
        previous[commonPrefix] === current[commonPrefix]
      ) {
        commonPrefix += 1;
      }
      transcript.push(...current.slice(commonPrefix));
    }
    previous = current;
  }

  return trimBlankEdges(transcript).join('\n');
};

const svgText = (lines) =>
  lines
    .map(
      (line, index) =>
        `<text x="12" y="${24 + index * 18}">${escapeXml(line || ' ')}</text>`
    )
    .join('');

const svgShell = ({ width, height, body }) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" rx="6" fill="#111827"/>',
    '<g fill="#e5e7eb" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">',
    body,
    '</g></svg>',
  ].join('');

const renderSnapshotSvg = (frame) => {
  const width = frame.cols * 9 + 24;
  const height = frame.rows * 18 + 18;
  return svgShell({
    width,
    height,
    body: svgText(frame.screen),
  });
};

const renderRecordingSvg = (frames) => {
  const columns = Math.max(...frames.map((frame) => frame.cols), 1);
  const rows = Math.max(...frames.map((frame) => frame.rows), 1);
  const width = columns * 9 + 24;
  const height = rows * 18 + 18;
  const frameCount = Math.max(frames.length, 1);
  const duration = Math.max(frameCount * 0.35, 0.35);
  const keyTimes = Array.from(
    { length: frameCount + 1 },
    (_, index) => index / frameCount
  ).join(';');

  const groups = frames
    .map((frame, frameIndex) => {
      const values = Array.from({ length: frameCount + 1 }, (_, index) =>
        index === frameIndex || (index === frameCount && frameIndex === 0)
          ? 1
          : 0
      ).join(';');
      return [
        '<g>',
        `<animate attributeName="opacity" calcMode="discrete" values="${values}" keyTimes="${keyTimes}" dur="${duration}s" repeatCount="indefinite"/>`,
        svgText(frame.screen),
        '</g>',
      ].join('');
    })
    .join('');

  return svgShell({ width, height, body: groups });
};

export const serializeAsciicast = ({ header, events }) => {
  const lines = [
    JSON.stringify(header),
    ...events.map((event) =>
      JSON.stringify([event.time, event.code, event.data])
    ),
  ];
  return `${lines.join('\n')}\n`;
};

export const readAsciicast = async (path) => {
  const { readFile } = await import('node:fs/promises');
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
  const header = JSON.parse(lines.shift());
  const events = lines.filter(Boolean).map((line) => {
    const [time, code, data] = JSON.parse(line);
    return { time, type: EVENT_TYPES[code] ?? code, data };
  });
  return { header, events };
};

export const writeTerminalArtifacts = async ({
  directory,
  frames,
  transcript,
  asciicast,
}) => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const finalFrame = frames.at(-1) ?? {
    cols: asciicast.header.width,
    rows: asciicast.header.height,
    screen: [],
  };

  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'transcript.txt'), `${transcript}\n`),
    writeFile(
      join(directory, 'frames.json'),
      `${JSON.stringify(frames, null, 2)}\n`
    ),
    writeFile(join(directory, 'session.cast'), serializeAsciicast(asciicast)),
    writeFile(join(directory, 'snapshot.svg'), renderSnapshotSvg(finalFrame)),
    writeFile(join(directory, 'recording.svg'), renderRecordingSvg(frames)),
  ]);
};
