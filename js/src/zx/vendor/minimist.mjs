// Dependency-free argument parser compatible with the `minimist` package
// (1.2.x) API that zx re-exports. Written from the documented behavior.

const NUMBER_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/;
const HEX_RE = /^0x[0-9a-f]+$/i;
const FLAG_LIKE_RE = /^(-|--)[^-]/;
const BOOL_WORD_RE = /^(true|false)$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isNumber(value) {
  if (typeof value === 'number') {
    return true;
  }
  return HEX_RE.test(value) || NUMBER_RE.test(value);
}

function toList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return [].concat(value);
}

function buildAliases(aliasOption) {
  const aliases = Object.create(null);
  for (const key of Object.keys(aliasOption || {})) {
    const group = [key, ...toList(aliasOption[key])];
    for (const name of group) {
      const others = group.filter((other) => other !== name);
      aliases[name] = [...new Set([...(aliases[name] || []), ...others])];
    }
  }
  return aliases;
}

function buildConfig(opts) {
  const aliases = buildAliases(opts.alias);
  const bools = Object.create(null);
  const strings = Object.create(null);
  const allBools = opts.boolean === true;

  if (!allBools) {
    for (const key of toList(opts.boolean).filter(Boolean)) {
      bools[key] = true;
    }
  }
  for (const key of toList(opts.string).filter(Boolean)) {
    strings[key] = true;
    for (const alias of aliases[key] || []) {
      strings[alias] = true;
    }
  }

  return {
    aliases,
    bools,
    strings,
    allBools,
    defaults: opts.default || {},
    unknown: typeof opts.unknown === 'function' ? opts.unknown : null,
    stopEarly: Boolean(opts.stopEarly),
    keepDoubleDash: Boolean(opts['--']),
  };
}

function hasPath(obj, keys) {
  let node = obj;
  for (const key of keys.slice(0, -1)) {
    node = node[key] || {};
  }
  return Object.prototype.hasOwnProperty.call(node, keys[keys.length - 1]);
}

function assignPath(obj, keys, value, config) {
  if (keys.some((key) => UNSAFE_KEYS.has(key))) {
    return;
  }
  let node = obj;
  for (const key of keys.slice(0, -1)) {
    const current = node[key];
    if (current === undefined || current === null) {
      node[key] = {};
    } else if (typeof current !== 'object') {
      return;
    }
    node = node[key];
  }

  const last = keys[keys.length - 1];
  const existing = node[last];
  if (
    existing === undefined ||
    config.bools[last] ||
    typeof existing === 'boolean'
  ) {
    node[last] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    node[last] = [existing, value];
  }
}

function assignWithAliases(argv, key, value, config) {
  for (const name of [key, ...(config.aliases[key] || [])]) {
    assignPath(argv, name.split('.'), value, config);
  }
}

function aliasIsBoolean(config, key) {
  return (config.aliases[key] || []).some((alias) => config.bools[alias]);
}

function isDeclared(config, key, arg) {
  return Boolean(
    (config.allBools && /^--[^=]+$/.test(arg)) ||
    config.strings[key] ||
    config.bools[key] ||
    config.aliases[key]
  );
}

function createParser(config) {
  const argv = { _: [] };

  const setArg = (key, raw, arg) => {
    if (arg && config.unknown && !isDeclared(config, key, arg)) {
      if (config.unknown(arg) === false) {
        return;
      }
    }
    const value = !config.strings[key] && isNumber(raw) ? Number(raw) : raw;
    assignWithAliases(argv, key, value, config);
  };

  // Whether the flag `key` may consume the following argument as its value.
  // Like upstream, only long flags honour `boolean: true` here.
  const takesValue = (key, next, arg) =>
    next !== undefined &&
    !FLAG_LIKE_RE.test(next) &&
    !config.bools[key] &&
    !(config.allBools && arg.startsWith('--')) &&
    !aliasIsBoolean(config, key);

  const emptyValue = (key) => (config.strings[key] ? '' : true);

  // Assigns a value to a flag that is written without `=`; returns how many
  // extra arguments were consumed.
  const setTrailingFlag = (key, next, arg) => {
    if (takesValue(key, next, arg)) {
      setArg(key, next, arg);
      return 1;
    }
    if (next !== undefined && BOOL_WORD_RE.test(next)) {
      setArg(key, next === 'true', arg);
      return 1;
    }
    setArg(key, emptyValue(key), arg);
    return 0;
  };

  return { argv, setArg, setTrailingFlag, emptyValue };
}

function parseLongFlag(parser, config, arg, next) {
  const withValue = /^--([^=]+)=([\s\S]*)$/.exec(arg);
  if (withValue) {
    const [, key, raw] = withValue;
    parser.setArg(key, config.bools[key] ? raw !== 'false' : raw, arg);
    return 0;
  }
  const negated = /^--no-(.+)/.exec(arg);
  if (negated) {
    parser.setArg(negated[1], false, arg);
    return 0;
  }
  return parser.setTrailingFlag(arg.slice(2), next, arg);
}

// Handles the letters of a short group except the last one. Returns true when
// the remainder of the group was consumed as a value.
function parseShortLetters(parser, arg) {
  const letters = arg.slice(1, -1).split('');
  for (let j = 0; j < letters.length; j++) {
    const letter = letters[j];
    const rest = arg.slice(j + 2);
    const isAlpha = /[A-Za-z]/.test(letter);

    if (rest === '-') {
      parser.setArg(letter, rest, arg);
    } else if (isAlpha && rest[0] === '=') {
      parser.setArg(letter, rest.slice(1), arg);
      return true;
    } else if (isAlpha && /-?\d+(\.\d*)?(e-?\d+)?$/.test(rest)) {
      parser.setArg(letter, rest, arg);
      return true;
    } else if (letters[j + 1] && /\W/.test(letters[j + 1])) {
      parser.setArg(letter, rest, arg);
      return true;
    } else {
      parser.setArg(letter, parser.emptyValue(letter), arg);
    }
  }
  return false;
}

function parseShortGroup(parser, arg, next) {
  if (parseShortLetters(parser, arg)) {
    return 0;
  }
  const key = arg.slice(-1);
  if (key === '-') {
    return 0;
  }
  return parser.setTrailingFlag(key, next, arg);
}

function applyDefaults(argv, config) {
  for (const key of Object.keys(config.defaults)) {
    if (hasPath(argv, key.split('.'))) {
      continue;
    }
    assignWithAliases(argv, key, config.defaults[key], config);
  }
}

function pushPositional(argv, config, arg) {
  if (config.unknown && config.unknown(arg) === false) {
    return;
  }
  argv._.push(config.strings._ || !isNumber(arg) ? arg : Number(arg));
}

/**
 * Parse command line arguments the way `minimist` does.
 * @param {string[]} [args]
 * @param {object} [opts]
 * @returns {{ _: Array<string|number>, [key: string]: any }}
 */
export default function minimist(args = [], opts = {}) {
  const config = buildConfig(opts || {});
  const parser = createParser(config);
  const { argv } = parser;

  for (const key of Object.keys(config.bools)) {
    const fallback = config.defaults[key];
    parser.setArg(key, fallback === undefined ? false : fallback);
  }

  let list = [...args].map(String);
  let afterDoubleDash = [];
  const doubleDash = list.indexOf('--');
  if (doubleDash !== -1) {
    afterDoubleDash = list.slice(doubleDash + 1);
    list = list.slice(0, doubleDash);
  }

  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (/^--.+/.test(arg)) {
      i += parseLongFlag(parser, config, arg, list[i + 1]);
    } else if (/^-[^-]+/.test(arg)) {
      i += parseShortGroup(parser, arg, list[i + 1]);
    } else {
      pushPositional(argv, config, arg);
      if (config.stopEarly) {
        argv._.push(...list.slice(i + 1));
        break;
      }
    }
  }

  applyDefaults(argv, config);

  if (config.keepDoubleDash) {
    argv['--'] = afterDoubleDash;
  } else {
    argv._.push(...afterDoubleDash);
  }
  return argv;
}

export { minimist };
