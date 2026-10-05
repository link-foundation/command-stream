// Dependency-free terminal string styler compatible with the `chalk` 5 API
// that zx re-exports. Written from the documented behavior.

import os from 'node:os';
import tty from 'node:tty';

const esc = (code) => `\u001B[${code}m`;

const MODIFIERS = {
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  overline: [53, 55],
  inverse: [7, 27],
  hidden: [8, 28],
  strikethrough: [9, 29],
};

const COLOR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];

const capitalize = (name) => name[0].toUpperCase() + name.slice(1);

function buildStyles() {
  const styles = {};
  for (const [name, [open, close]] of Object.entries(MODIFIERS)) {
    styles[name] = { open: esc(open), close: esc(close) };
  }
  COLOR_NAMES.forEach((name, i) => {
    const bgName = `bg${capitalize(name)}`;
    styles[name] = { open: esc(30 + i), close: esc(39) };
    styles[`${name}Bright`] = { open: esc(90 + i), close: esc(39) };
    styles[bgName] = { open: esc(40 + i), close: esc(49) };
    styles[`${bgName}Bright`] = { open: esc(100 + i), close: esc(49) };
  });
  for (const alias of ['gray', 'grey']) {
    styles[alias] = styles.blackBright;
    styles[`bg${capitalize(alias)}`] = styles.bgBlackBright;
  }
  return styles;
}

const STYLES = buildStyles();

// --- color model conversions -------------------------------------------------

function rgbToAnsi256(red, green, blue) {
  if (red === green && green === blue) {
    if (red < 8) {
      return 16;
    }
    if (red > 248) {
      return 231;
    }
    return Math.round(((red - 8) / 247) * 24) + 232;
  }
  const scale = (value) => Math.round((value / 255) * 5);
  return 16 + 36 * scale(red) + 6 * scale(green) + scale(blue);
}

// Maps a 256-color palette index to its normalized [r, g, b] (0..1) value.
function ansi256ToUnitRgb(code) {
  if (code >= 232) {
    const gray = ((code - 232) * 10 + 8) / 255;
    return [gray, gray, gray];
  }
  const cube = code - 16;
  const rest = cube % 36;
  return [Math.floor(cube / 36) / 5, Math.floor(rest / 6) / 5, (rest % 6) / 5];
}

function ansi256ToAnsi16(code) {
  if (code < 8) {
    return 30 + code;
  }
  if (code < 16) {
    return 90 + (code - 8);
  }
  const [red, green, blue] = ansi256ToUnitRgb(code);
  const brightness = Math.max(red, green, blue) * 2;
  if (brightness === 0) {
    return 30;
  }
  const bits =
    (Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red);
  return 30 + bits + (brightness === 2 ? 60 : 0);
}

function hexToRgb(hex) {
  const match = /[a-f\d]{6}|[a-f\d]{3}/i.exec(String(hex));
  if (!match) {
    return [0, 0, 0];
  }
  let digits = match[0];
  if (digits.length === 3) {
    digits = [...digits].map((d) => d + d).join('');
  }
  const value = Number.parseInt(digits, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

// Builds the open/close codes for a 256-color index (and optional truecolor
// triple) at the given color level; `bg` selects the background variant.
function paletteStyle(level, bg, index, rgb) {
  const close = esc(bg ? 49 : 39);
  if (level >= 3 && rgb) {
    return { open: esc(`${bg ? 48 : 38};2;${rgb.join(';')}`), close };
  }
  if (level >= 2) {
    return { open: esc(`${bg ? 48 : 38};5;${index}`), close };
  }
  return { open: esc(ansi256ToAnsi16(index) + (bg ? 10 : 0)), close };
}

const MODELS = {
  rgb: (level, bg, red, green, blue) =>
    paletteStyle(level, bg, rgbToAnsi256(red, green, blue), [red, green, blue]),
  hex: (level, bg, hex) => MODELS.rgb(level, bg, ...hexToRgb(hex)),
  ansi256: (level, bg, index) => paletteStyle(level, bg, index, null),
};

// --- color support detection -------------------------------------------------

function hasFlag(flag, argv) {
  const prefix = flag.startsWith('-') ? '' : flag.length === 1 ? '-' : '--';
  const position = argv.indexOf(prefix + flag);
  const terminator = argv.indexOf('--');
  return position !== -1 && (terminator === -1 || position < terminator);
}

function levelFromEnvForce(env) {
  if (!('FORCE_COLOR' in env)) {
    return undefined;
  }
  const value = env.FORCE_COLOR;
  if (value === 'true' || value === '') {
    return 1;
  }
  if (value === 'false') {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 0), 3);
}

function levelFromFlags(argv) {
  const anyFlag = (flags) => flags.some((flag) => hasFlag(flag, argv));
  if (anyFlag(['no-color', 'no-colors', 'color=false', 'color=never'])) {
    return 0;
  }
  if (anyFlag(['color=16m', 'color=full', 'color=truecolor'])) {
    return 3;
  }
  if (hasFlag('color=256', argv)) {
    return 2;
  }
  if (anyFlag(['color', 'colors', 'color=true', 'color=always'])) {
    return 1;
  }
  return undefined;
}

function levelFromTerminal(env, fallback) {
  const term = env.TERM || '';
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') {
    return 3;
  }
  if (
    term === 'xterm-kitty' ||
    term === 'xterm-ghostty' ||
    term === 'wezterm'
  ) {
    return 3;
  }
  if (env.TERM_PROGRAM === 'iTerm.app') {
    return 3;
  }
  if (env.TERM_PROGRAM === 'Apple_Terminal' || /-256(color)?$/i.test(term)) {
    return 2;
  }
  if (
    /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(term) ||
    'COLORTERM' in env
  ) {
    return 1;
  }
  return fallback;
}

function levelFromCi(env, fallback) {
  if (env.GITHUB_ACTIONS || env.GITEA_ACTIONS) {
    return 3;
  }
  const known = ['TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI', 'BUILDKITE'];
  if (known.some((name) => name in env) || env.CI_NAME === 'codeship') {
    return 1;
  }
  return fallback;
}

function windowsLevel() {
  const [major, , build] = os.release().split('.').map(Number);
  if (major >= 10 && build >= 10586) {
    return build >= 14931 ? 3 : 2;
  }
  return 1;
}

// FORCE_COLOR wins over command line flags; NO_COLOR applies otherwise.
function forcedLevel(env, argv) {
  const envForce = levelFromEnvForce(env);
  const forced = envForce === undefined ? levelFromFlags(argv) : envForce;
  if (forced === undefined && 'NO_COLOR' in env) {
    return 0;
  }
  return forced;
}

/**
 * Detect the color level (0..3) supported by a stream, like `supports-color`.
 * @param {{ isTTY?: boolean }} [stream]
 * @param {Record<string, string|undefined>} [env]
 * @param {string[]} [argv]
 * @returns {number}
 */
export function detectColorLevel(
  stream = process.stdout,
  env = process.env,
  argv = process.argv || []
) {
  const forced = forcedLevel(env, argv);
  if (forced === 0 || (forced === undefined && !(stream && stream.isTTY))) {
    return 0;
  }
  const min = forced || 0;
  if (env.TERM === 'dumb') {
    return min;
  }
  if (process.platform === 'win32') {
    return Math.max(min, windowsLevel());
  }
  if ('CI' in env) {
    return Math.max(min, levelFromCi(env, min));
  }
  return Math.max(min, levelFromTerminal(env, min));
}

function toSupport(level) {
  if (!level) {
    return false;
  }
  return { level, hasBasic: true, has256: level >= 2, has16m: level >= 3 };
}

const stdoutLevel = detectColorLevel(
  { isTTY: Boolean(process.stdout && process.stdout.isTTY) || tty.isatty(1) },
  process.env
);

export const supportsColor = toSupport(stdoutLevel);

// --- the chainable builder ---------------------------------------------------

const STATE = Symbol('chalkState');
const STYLER = Symbol('chalkStyler');
const IS_EMPTY = Symbol('chalkIsEmpty');

function createStyler(open, close, parent) {
  return {
    open,
    close,
    openAll: parent ? parent.openAll + open : open,
    closeAll: parent ? close + parent.closeAll : close,
    parent,
  };
}

function applyStyle(builder, args) {
  let text = args.length === 1 ? `${args[0]}` : args.join(' ');
  if (builder[STATE].level <= 0 || !text) {
    return builder[IS_EMPTY] ? '' : text;
  }
  const styler = builder[STYLER];
  if (!styler) {
    return text;
  }
  if (text.includes('\u001B')) {
    // Re-open every outer style after nested content closes it.
    for (let node = styler; node; node = node.parent) {
      text = text.split(node.close).join(node.close + node.open);
    }
  }
  if (text.includes('\n')) {
    text = text.replace(
      /\r?\n/g,
      (lineBreak) => styler.closeAll + lineBreak + styler.openAll
    );
  }
  return styler.openAll + text + styler.closeAll;
}

const builderProto = Object.create(Function.prototype);

function createBuilder(state, styler, isEmpty) {
  const builder = (...args) => applyStyle(builder, args);
  Object.setPrototypeOf(builder, builderProto);
  builder[STATE] = state;
  builder[STYLER] = styler;
  builder[IS_EMPTY] = isEmpty;
  return builder;
}

function defineChainGetter(name, makeStyler, isEmpty = false) {
  Object.defineProperty(builderProto, name, {
    configurable: true,
    get() {
      const builder = createBuilder(
        this[STATE],
        makeStyler(this[STYLER]),
        isEmpty || Boolean(this[IS_EMPTY])
      );
      Object.defineProperty(this, name, { value: builder });
      return builder;
    },
  });
}

for (const [name, { open, close }] of Object.entries(STYLES)) {
  defineChainGetter(name, (parent) => createStyler(open, close, parent));
}
defineChainGetter('visible', (parent) => parent, true);

for (const [model, convert] of Object.entries(MODELS)) {
  for (const bg of [false, true]) {
    const name = bg ? `bg${capitalize(model)}` : model;
    Object.defineProperty(builderProto, name, {
      configurable: true,
      get() {
        return (...values) => {
          const { open, close } = convert(this[STATE].level, bg, ...values);
          return createBuilder(
            this[STATE],
            createStyler(open, close, this[STYLER]),
            Boolean(this[IS_EMPTY])
          );
        };
      },
    });
  }
}

Object.defineProperty(builderProto, 'level', {
  configurable: true,
  enumerable: true,
  get() {
    return this[STATE].level;
  },
  set(level) {
    this[STATE].level = level;
  },
});

function validateLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > 3) {
    throw new Error('The `level` option should be an integer from 0 to 3');
  }
  return level;
}

function createChalk(options = {}) {
  const level =
    options.level === undefined ? stdoutLevel : validateLevel(options.level);
  const instance = (...strings) => strings.join(' ');
  Object.setPrototypeOf(instance, builderProto);
  instance[STATE] = { level };
  instance[STYLER] = undefined;
  instance[IS_EMPTY] = false;
  return instance;
}

/** Create an independent chalk instance: `new Chalk({ level: 1 })`. */
export class Chalk {
  constructor(options) {
    return createChalk(options);
  }
}

export const modifierNames = Object.keys(MODIFIERS);
export const foregroundColorNames = Object.keys(STYLES).filter(
  (name) => !name.startsWith('bg') && !(name in MODIFIERS)
);
export const backgroundColorNames = Object.keys(STYLES).filter((name) =>
  name.startsWith('bg')
);
export const colorNames = [...foregroundColorNames, ...backgroundColorNames];

const chalk = createChalk();

export default chalk;
