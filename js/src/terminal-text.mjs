const ATTRIBUTES = [
  ['bold', 1],
  ['dim', 2],
  ['italic', 3],
  ['underline', 4],
  ['reverse', 7],
  ['invisible', 8],
  ['strikethrough', 9],
];

function coloredLine(cells) {
  let text = '';
  const last = cells.findLastIndex(
    (cell) =>
      cell.chars !== ' ' ||
      cell.fg ||
      cell.bg ||
      ATTRIBUTES.some(([name]) => cell[name])
  );
  for (const cell of cells.slice(0, last + 1)) {
    if (!cell.width) {
      continue;
    }
    const codes = [];
    for (const [attribute, code] of ATTRIBUTES) {
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
  }
  return text;
}

export function terminalText(frame, { color = false } = {}) {
  if (!color) {
    return frame.screen.join('\n');
  }
  const lines = frame.cells.map(coloredLine);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.join('\n');
}
