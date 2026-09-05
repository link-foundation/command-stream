const EVENT_TYPES = {
  i: 'input',
  o: 'output',
  r: 'resize',
};

const DEFAULTS = {
  background: '#111827',
  foreground: '#e5e7eb',
  cellWidth: 9,
  cellHeight: 18,
  fontSize: 14,
  padding: 12,
  borderRadius: 0,
  idleTimeLimit: 2,
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

const xtermPaletteColor = (index) => {
  if (index < ANSI_COLORS.length) {
    return ANSI_COLORS[index];
  }
  if (index < 232) {
    const offset = index - 16;
    const component = (value) => (value === 0 ? 0 : value * 40 + 55);
    const red = component(Math.floor(offset / 36));
    const green = component(Math.floor((offset % 36) / 6));
    const blue = component(offset % 6);
    return `#${[red, green, blue]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  const gray = (index - 232) * 10 + 8;
  return `#${gray.toString(16).padStart(2, '0').repeat(3)}`;
};

const resolveColor = (color, fallback) =>
  typeof color === 'string'
    ? color
    : color?.palette !== undefined
      ? xtermPaletteColor(color.palette)
      : fallback;

const cellStyle = (cell, options) => {
  let fg = resolveColor(cell.fg, options.foreground);
  let bg = resolveColor(cell.bg, options.background);
  if (cell.reverse) {
    [fg, bg] = [bg, fg];
  }
  return {
    fg,
    bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline,
    strikethrough: cell.strikethrough,
    invisible: cell.invisible,
  };
};

const sameStyle = (left, right) =>
  Object.keys(left).every((key) => left[key] === right[key]);

const isBlankCell = (cell) => (cell.chars || ' ').trim() === '';

const coalesceRow = (cells, options) => {
  const runs = [];
  for (let column = 0; column < cells.length;) {
    const cell = cells[column];
    if (cell.width === 0) {
      column += 1;
      continue;
    }
    if (isBlankCell(cell)) {
      column += Math.max(cell.width, 1);
      continue;
    }
    const style = cellStyle(cell, options);
    const run = {
      column,
      width: Math.max(cell.width, 1),
      text: cell.chars,
      style,
    };
    let visibleTextLength = run.text.length;
    let visibleWidth = run.width;
    column += Math.max(cell.width, 1);
    while (column < cells.length) {
      const next = cells[column];
      if (
        next.width === 0 ||
        !sameStyle(style, cellStyle(next, options)) ||
        isVectorCharacter(run.text.at(-1)) ||
        isVectorCharacter(next.chars)
      ) {
        break;
      }
      run.text += next.chars || ' ';
      run.width += Math.max(next.width, 1);
      column += Math.max(next.width, 1);
      if (!isBlankCell(next)) {
        visibleTextLength = run.text.length;
        visibleWidth = run.width;
      }
    }
    run.text = run.text.slice(0, visibleTextLength);
    run.width = visibleWidth;
    runs.push(run);
  }
  return runs;
};

const isVectorCharacter = (character = '') => {
  const code = character.codePointAt(0);
  return (
    (code >= 0x2500 && code <= 0x257f) || (code >= 0x2580 && code <= 0x259f)
  );
};

const vectorCharacter = (character, x, y, width, height, color) => {
  const code = character.codePointAt(0);
  if (code >= 0x2580 && code <= 0x259f) {
    if (character === '▀') {
      return `<rect x="${x}" y="${y}" width="${width}" height="${height / 2}" fill="${color}"/>`;
    }
    if (character === '▄') {
      return `<rect x="${x}" y="${y + height / 2}" width="${width}" height="${height / 2}" fill="${color}"/>`;
    }
    if (character === '▌') {
      return `<rect x="${x}" y="${y}" width="${width / 2}" height="${height}" fill="${color}"/>`;
    }
    if (character === '▐') {
      return `<rect x="${x + width / 2}" y="${y}" width="${width / 2}" height="${height}" fill="${color}"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`;
  }

  const middleX = x + width / 2;
  const middleY = y + height / 2;
  const left = /[─━┄┅┈┉┌┍┎┏┬┭┮┯┐┑┒┓┤┥┦┧┨┩┪┫┴┵┶┷┸┹┺┻┘┙┚┛┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋]/u.test(
    character
  );
  const right = /[─━┄┅┈┉┌┍┎┏├┝┞┟┠┡┢┣┬┭┮┯└┕┖┗┴┵┶┷┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋]/u.test(
    character
  );
  const top = /[│┃┆┇┊┋┌┍┎┏┐┑┒┓├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋]/u.test(
    character
  );
  const bottom = /[│┃┆┇┊┋├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫└┕┖┗┘┙┚┛┴┵┶┷┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋]/u.test(
    character
  );
  const commands = [
    left && `M${x} ${middleY}H${middleX}`,
    right && `M${middleX} ${middleY}H${x + width}`,
    top && `M${middleX} ${y}V${middleY}`,
    bottom && `M${middleX} ${middleY}V${y + height}`,
  ]
    .filter(Boolean)
    .join('');
  return `<path d="${commands}" fill="none" stroke="${color}" stroke-width="1"/>`;
};

const renderFrame = (frame, options) => {
  const rows = frame.cells ?? [];
  const backgrounds = [];
  const foregrounds = [];
  rows.forEach((cells, row) => {
    for (let column = 0; column < cells.length;) {
      const first = cells[column];
      const background = cellStyle(first, options).bg;
      let width = Math.max(first.width, 1);
      column += Math.max(first.width, 1);
      while (
        column < cells.length &&
        cellStyle(cells[column], options).bg === background
      ) {
        width += Math.max(cells[column].width, 1);
        column += Math.max(cells[column].width, 1);
      }
      if (background !== options.background) {
        backgrounds.push(
          `<rect x="${options.padding + (column - width) * options.cellWidth}" y="${options.padding + row * options.cellHeight}" width="${width * options.cellWidth}" height="${options.cellHeight}" fill="${background}"/>`
        );
      }
    }
    for (const run of coalesceRow(cells, options)) {
      const x = options.padding + run.column * options.cellWidth;
      const y = options.padding + row * options.cellHeight;
      const runWidth = run.width * options.cellWidth;
      if (run.style.invisible || run.text.trim() === '') {
        continue;
      }
      if (isVectorCharacter(run.text)) {
        foregrounds.push(
          vectorCharacter(
            run.text,
            x,
            y,
            runWidth,
            options.cellHeight,
            run.style.fg
          )
        );
        continue;
      }
      const decorations = [
        run.style.underline && 'underline',
        run.style.strikethrough && 'line-through',
      ]
        .filter(Boolean)
        .join(' ');
      const attributes = [
        `x="${x}"`,
        `y="${y + options.fontSize}"`,
        `fill="${run.style.fg}"`,
        `textLength="${runWidth}"`,
        'lengthAdjust="spacingAndGlyphs"',
        run.style.bold && 'font-weight="bold"',
        run.style.italic && 'font-style="italic"',
        run.style.dim && 'opacity="0.5"',
        decorations && `text-decoration="${decorations}"`,
      ]
        .filter(Boolean)
        .join(' ');
      foregrounds.push(`<text ${attributes}>${escapeXml(run.text)}</text>`);
    }
  });
  return `${backgrounds.join('')}${foregrounds.join('')}`;
};

let embeddedFontPromise;
const embeddedFont = () => {
  embeddedFontPromise ??= import('node:fs/promises').then(({ readFile }) =>
    readFile(
      new URL('./assets/dejavu-sans-mono-terminal.woff2', import.meta.url)
    ).then((font) => font.toString('base64'))
  );
  return embeddedFontPromise;
};

const dimensions = (frames, options) => {
  const columns = Math.max(...frames.map((frame) => frame.cols), 1);
  const rows = Math.max(...frames.map((frame) => frame.rows), 1);
  return {
    width: columns * options.cellWidth + options.padding * 2,
    height: rows * options.cellHeight + options.padding * 2,
  };
};

const svgShell = ({
  width,
  height,
  body,
  options,
  font,
  style = '',
  background = true,
}) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<style>',
    `@font-face{font-family:"Terminal Artifact";src:url(data:font/woff2;base64,${font}) format("woff2");}`,
    style,
    '</style>',
    background &&
      `<rect width="100%" height="100%" rx="${options.borderRadius}" fill="${options.background}"/>`,
    `<g font-family='"Terminal Artifact", "DejaVu Sans Mono", monospace' font-size="${options.fontSize}" shape-rendering="crispEdges">`,
    body,
    '</g></svg>',
  ].join('');

const frameTimes = (frames, idleTimeLimit) => {
  const times = [];
  let elapsed = 0;
  for (let index = 0; index < frames.length; index += 1) {
    if (index > 0) {
      elapsed += Math.min(
        Math.max(
          frames[index].time - (index === 1 ? 0 : frames[index - 1].time),
          0.01
        ),
        idleTimeLimit
      );
    }
    times.push(elapsed);
  }
  return { times, duration: Math.max(elapsed, 0.01) };
};

const renderSnapshotSvg = ({ frame, options, font }) => {
  const { width, height } = dimensions([frame], options);
  return svgShell({
    width,
    height,
    body: renderFrame(frame, options),
    options,
    font,
  });
};

const renderRecordingSvg = ({ frames, options, font }) => {
  const { width, height } = dimensions(frames, options);
  const { times, duration } = frameTimes(frames, options.idleTimeLimit);
  const keyframes = times
    .map(
      (time, index) =>
        `${((time / duration) * 100).toFixed(6)}%{transform:translateY(-${index * height}px)}`
    )
    .join('');
  const strip = frames
    .map(
      (frame, index) =>
        `<g transform="translate(0 ${index * height})">${renderFrame(frame, options)}</g>`
    )
    .join('');
  const style = [
    `@keyframes terminalFrames{${keyframes}}`,
    `.terminal-filmstrip{animation-name:terminalFrames;animation-duration:${duration}s;animation-timing-function:steps(1, end);animation-iteration-count:infinite;}`,
  ].join('');
  return svgShell({
    width,
    height,
    body: `<svg width="${width}" height="${height}" overflow="hidden"><g class="terminal-filmstrip">${strip}</g></svg>`,
    options,
    font,
    style,
  });
};

const renderGif = async ({ frames, options, font }) => {
  const [{ Resvg }, gifencModule] = await Promise.all([
    import('@resvg/resvg-js'),
    import('gifenc'),
  ]);
  const gifenc = gifencModule.GIFEncoder ? gifencModule : gifencModule.default;
  const { GIFEncoder, applyPalette, quantize } = gifenc;
  const { width, height } = dimensions(frames, options);
  const { times } = frameTimes(frames, options.idleTimeLimit);
  const sheet = svgShell({
    width,
    height: height * frames.length,
    body: frames
      .map(
        (frame, index) =>
          `<g transform="translate(0 ${index * height})"><rect width="${width}" height="${height}" rx="${options.borderRadius}" fill="${options.background}"/>${renderFrame(frame, options)}</g>`
      )
      .join(''),
    options,
    font,
    background: false,
  });
  const sheetPixels = new Resvg(sheet).render().pixels;
  const gif = GIFEncoder();
  for (const index of frames.keys()) {
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const sourceStart = (index * height + row) * width * 4;
      pixels.set(
        sheetPixels.subarray(sourceStart, sourceStart + width * 4),
        row * width * 4
      );
    }
    const palette = quantize(pixels, 256);
    gif.writeFrame(applyPalette(pixels, palette), width, height, {
      palette,
      delay: Math.max(
        Math.round(
          ((times[index + 1] ?? times[index] + 0.1) - times[index]) * 1000
        ),
        10
      ),
      repeat: 0,
    });
  }
  gif.finish();
  return gif.bytes();
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
  options: requestedOptions = {},
}) => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const options = { ...DEFAULTS, ...requestedOptions };
  const finalFrame = frames.at(-1) ?? {
    cols: asciicast.header.width,
    rows: asciicast.header.height,
    screen: [],
    cells: [],
  };
  const renderFrames = frames.length ? frames : [finalFrame];
  const font = await embeddedFont();

  await mkdir(directory, { recursive: true });
  const snapshot = renderSnapshotSvg({ frame: finalFrame, options, font });
  const recording = renderRecordingSvg({
    frames: renderFrames,
    options,
    font,
  });
  const gif = await renderGif({ frames: renderFrames, options, font });
  await Promise.all([
    writeFile(join(directory, 'transcript.txt'), `${transcript}\n`),
    writeFile(
      join(directory, 'frames.json'),
      `${JSON.stringify(frames, null, 2)}\n`
    ),
    writeFile(join(directory, 'session.cast'), serializeAsciicast(asciicast)),
    writeFile(join(directory, 'snapshot.svg'), snapshot),
    writeFile(join(directory, 'recording.svg'), recording),
    writeFile(join(directory, 'recording.gif'), gif),
  ]);
};
