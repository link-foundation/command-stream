// Schemas and scalar tag resolution (failsafe, json, core, yaml-1.1).

export const TAG_PREFIX = 'tag:yaml.org,2002:';
export const TAGS = {
  str: `${TAG_PREFIX}str`,
  int: `${TAG_PREFIX}int`,
  float: `${TAG_PREFIX}float`,
  bool: `${TAG_PREFIX}bool`,
  null: `${TAG_PREFIX}null`,
  map: `${TAG_PREFIX}map`,
  seq: `${TAG_PREFIX}seq`,
  binary: `${TAG_PREFIX}binary`,
  merge: `${TAG_PREFIX}merge`,
};

const CORE_NULL = /^(?:~|null|Null|NULL)?$/;
const CORE_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
const CORE_INT = /^[-+]?[0-9]+$/;
const CORE_OCT = /^0o[0-7]+$/;
const CORE_HEX = /^0x[0-9a-fA-F]+$/;
const CORE_FLOAT =
  /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const CORE_INF = /^[-+]?\.(?:inf|Inf|INF)$/;
const CORE_NAN = /^\.(?:nan|NaN|NAN)$/;

const JSON_INT = /^-?(?:0|[1-9][0-9]*)$/;
const JSON_FLOAT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/;

const Y11_NULL = CORE_NULL;
const Y11_TRUE = /^(?:y|Y|yes|Yes|YES|true|True|TRUE|on|On|ON)$/;
const Y11_FALSE = /^(?:n|N|no|No|NO|false|False|FALSE|off|Off|OFF)$/;
const Y11_BIN = /^[-+]?0b[0-1_]+$/;
const Y11_OCT = /^[-+]?0[0-7_]+$/;
const Y11_INT = /^[-+]?(?:0|[1-9][0-9_]*)$/;
const Y11_HEX = /^[-+]?0x[0-9a-fA-F_]+$/;
const Y11_FLOAT = /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*(?:[eE][-+]?[0-9]+)?$/;
const Y11_EXP = /^[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/;

function toInt(str, radix, opts) {
  if (opts.intAsBigInt) {
    const sign = str[0] === '-' ? -1n : 1n;
    const body = str.replace(/^[-+]/, '');
    const prefix = { 16: '0x', 8: '0o', 2: '0b' }[radix] || '';
    const digits = radix === 10 ? body : body.replace(/^0[xob]?/, '');
    return sign * BigInt(`${prefix}${digits || '0'}`);
  }
  const sign = str[0] === '-' ? -1 : 1;
  const body = str.replace(/^[-+]/, '');
  const digits = radix === 10 ? body : body.replace(/^0[xob]?/, '');
  return sign * parseInt(digits || '0', radix);
}

function floatResult(str) {
  const res = { value: parseFloat(str), tag: TAGS.float };
  if (/[eE]/.test(str)) {
    res.format = 'EXP';
  }
  const dot = str.indexOf('.');
  if (dot !== -1) {
    const frac = str.slice(dot + 1).replace(/[eE].*$/, '');
    if (frac.endsWith('0')) {
      res.minFractionDigits = frac.length;
    }
  }
  return res;
}

function specialFloat(str) {
  if (CORE_NAN.test(str)) {
    return { value: NaN, tag: TAGS.float };
  }
  if (CORE_INF.test(str)) {
    return {
      value: str[0] === '-' ? -Infinity : Infinity,
      tag: TAGS.float,
    };
  }
  return null;
}

function resolveCore(str, opts) {
  if (CORE_NULL.test(str)) {
    return { value: null, tag: TAGS.null };
  }
  if (CORE_BOOL.test(str)) {
    return { value: str[0] === 't' || str[0] === 'T', tag: TAGS.bool };
  }
  if (CORE_INT.test(str)) {
    return { value: toInt(str, 10, opts), tag: TAGS.int };
  }
  if (CORE_OCT.test(str)) {
    return { value: toInt(str, 8, opts), tag: TAGS.int, format: 'OCT' };
  }
  if (CORE_HEX.test(str)) {
    return { value: toInt(str, 16, opts), tag: TAGS.int, format: 'HEX' };
  }
  if (CORE_FLOAT.test(str)) {
    return floatResult(str);
  }
  return specialFloat(str);
}

function resolveJson(str, opts) {
  if (str === 'null') {
    return { value: null, tag: TAGS.null };
  }
  if (str === 'true' || str === 'false') {
    return { value: str === 'true', tag: TAGS.bool };
  }
  if (JSON_INT.test(str)) {
    return { value: toInt(str, 10, opts), tag: TAGS.int };
  }
  if (JSON_FLOAT.test(str)) {
    return floatResult(str);
  }
  return null;
}

function resolveY11Number(str, opts) {
  const clean = (s) => s.replace(/_/g, '');
  if (Y11_BIN.test(str)) {
    return { value: toInt(clean(str), 2, opts), tag: TAGS.int, format: 'BIN' };
  }
  if (Y11_HEX.test(str)) {
    return { value: toInt(clean(str), 16, opts), tag: TAGS.int, format: 'HEX' };
  }
  if (Y11_OCT.test(str)) {
    const body = clean(str).replace(/^([-+]?)0/, '$1');
    return { value: toInt(body, 8, opts), tag: TAGS.int, format: 'OCT' };
  }
  if (Y11_INT.test(str)) {
    return { value: toInt(clean(str), 10, opts), tag: TAGS.int };
  }
  if (Y11_FLOAT.test(str) || Y11_EXP.test(str)) {
    return floatResult(clean(str));
  }
  return specialFloat(str);
}

function resolveY11(str, opts) {
  if (Y11_NULL.test(str)) {
    return { value: null, tag: TAGS.null };
  }
  if (Y11_TRUE.test(str)) {
    return { value: true, tag: TAGS.bool };
  }
  if (Y11_FALSE.test(str)) {
    return { value: false, tag: TAGS.bool };
  }
  return resolveY11Number(str, opts);
}

const RESOLVERS = {
  core: resolveCore,
  json: resolveJson,
  'yaml-1.1': resolveY11,
  failsafe: () => null,
};

function decodeBase64(str) {
  const clean = str.replace(/[\s]/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(clean, 'base64');
  }
  const bin = globalThis.atob(clean);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function resolveExplicit(schema, tag, str, opts) {
  switch (tag) {
    case TAGS.str:
      return { value: str, tag };
    case TAGS.null:
      return { value: null, tag };
    case TAGS.bool: {
      const res = resolveCore(str, opts);
      return res && res.tag === tag ? res : null;
    }
    case TAGS.int: {
      const res = schema.resolvePlain(str, opts);
      return res && res.tag === tag ? res : null;
    }
    case TAGS.float: {
      const res = schema.resolvePlain(str, opts);
      return res && res.tag === tag ? res : null;
    }
    case TAGS.binary:
      return { value: decodeBase64(str), tag };
    default:
      return undefined;
  }
}

/** A minimal Schema compatible with the shape of yaml's Schema class. */
export class Schema {
  constructor({
    schema,
    version,
    customTags,
    merge,
    sortMapEntries,
    toStringDefaults,
  } = {}) {
    let name = schema || (version === '1.1' ? 'yaml-1.1' : 'core');
    if (!RESOLVERS[name]) {
      name = 'core';
    }
    this.name = name;
    this.merge = merge ?? name === 'yaml-1.1';
    this.knownTags = { ...TAGS };
    this.tags = Array.isArray(customTags) ? [...customTags] : [];
    this.sortMapEntries =
      sortMapEntries === true
        ? (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        : typeof sortMapEntries === 'function'
          ? sortMapEntries
          : null;
    this.toStringOptions = toStringDefaults ?? null;
  }

  clone() {
    const copy = Object.create(Schema.prototype, {
      ...Object.getOwnPropertyDescriptors(this),
    });
    copy.tags = this.tags.slice();
    return copy;
  }

  /** Resolve a plain (untagged, unquoted) scalar source string. */
  resolvePlain(str, opts = {}) {
    return RESOLVERS[this.name](str, opts);
  }

  /**
   * Resolve a scalar string with an explicit tag. Returns undefined for
   * unknown tags, null when the value is not valid for a known tag.
   */
  resolveTagged(tag, str, opts = {}) {
    const custom = this.tags.find(
      (t) => t && typeof t === 'object' && t.tag === tag && t.resolve
    );
    if (custom) {
      return { value: custom.resolve(str, () => {}, opts), tag };
    }
    return resolveExplicit(this, tag, str, opts);
  }
}
