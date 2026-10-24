// Node classes (Scalar, Alias, Pair, YAMLMap, YAMLSeq), type predicates and
// conversion between node trees and plain JavaScript values.

import { createStringifyContext, stringifyNode } from './yaml-stringify.mjs';
import { emitWarning } from './yaml-errors.mjs';

export const NODE_TYPE = Symbol.for('yaml.node.type');
export const ALIAS = Symbol.for('yaml.alias');
export const DOC = Symbol.for('yaml.document');
export const MAP = Symbol.for('yaml.map');
export const PAIR = Symbol.for('yaml.pair');
export const SCALAR = Symbol.for('yaml.scalar');
export const SEQ = Symbol.for('yaml.seq');

const typeOf = (node) =>
  node && typeof node === 'object' ? node[NODE_TYPE] : undefined;

export const isAlias = (node) => typeOf(node) === ALIAS;
export const isDocument = (node) => typeOf(node) === DOC;
export const isMap = (node) => typeOf(node) === MAP;
export const isPair = (node) => typeOf(node) === PAIR;
export const isScalar = (node) => typeOf(node) === SCALAR;
export const isSeq = (node) => typeOf(node) === SEQ;
export const isCollection = (node) => {
  const t = typeOf(node);
  return t === MAP || t === SEQ;
};
export const isNode = (node) => {
  const t = typeOf(node);
  return t === ALIAS || t === MAP || t === SCALAR || t === SEQ;
};

function defineType(obj, type) {
  Object.defineProperty(obj, NODE_TYPE, { value: type });
}

function cloneInto(source, target) {
  for (const key of Object.keys(source)) {
    target[key] = source[key];
  }
  if (source.range) {
    target.range = source.range.slice();
  }
  return target;
}

// ---------------------------------------------------------------------------
// toJS conversion
// ---------------------------------------------------------------------------

/** Create the conversion context used by `toJS()`. */
export function createToJSContext(doc, options = {}) {
  return {
    doc,
    keep: false,
    mapAsMap: options.mapAsMap === true,
    maxAliasCount:
      typeof options.maxAliasCount === 'number' ? options.maxAliasCount : 100,
    onAnchor: options.onAnchor,
    anchorsByName: new Map(),
    values: new Map(),
    aliasCounts: new Map(),
  };
}

/** Convert a node (or plain value) into a JavaScript value. */
export function toJS(value, arg, ctx) {
  if (Array.isArray(value)) {
    return value.map((item, i) => toJS(item, String(i), ctx));
  }
  if (value && typeof value.toJSON === 'function') {
    if (!ctx || !isNode(value) || isAlias(value)) {
      return value.toJSON(arg, ctx);
    }
    if (value.anchor) {
      ctx.anchorsByName.set(value.anchor, value);
    }
    const res = value.toJSON(arg, ctx);
    if (!ctx.values.has(value)) {
      ctx.values.set(value, res);
    }
    return res;
  }
  if (typeof value === 'bigint' && !ctx?.keep) {
    return Number(value);
  }
  return value;
}

function registerValue(node, res, ctx) {
  if (ctx) {
    ctx.values.set(node, res);
  }
}

function stringifyKey(keyNode, jsKey, ctx) {
  if (jsKey === null) {
    return '';
  }
  if (typeof jsKey !== 'object') {
    return String(jsKey);
  }
  if (isNode(keyNode) && ctx?.doc) {
    const str = stringifyNode(keyNode, {
      ...createStringifyContext(ctx.doc, { lineWidth: 0 }),
      inFlow: true,
      implicitKey: true,
    });
    if (!ctx.mapKeyWarned) {
      ctx.mapKeyWarned = true;
      emitWarning(
        `Keys with collection values will be stringified due to JS Object restrictions: ${JSON.stringify(str)}. Set mapAsMap: true to use object keys.`,
        ctx.doc.options?.logLevel
      );
    }
    return str;
  }
  return JSON.stringify(jsKey);
}

function setMapValue(map, key, value) {
  if (map instanceof Map) {
    map.set(key, value);
  } else if (key === '__proto__') {
    Object.defineProperty(map, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    map[key] = value;
  }
}

function hasMapKey(map, key) {
  return map instanceof Map
    ? map.has(key)
    : Object.prototype.hasOwnProperty.call(map, key);
}

function isMergeKey(ctx, key) {
  const schema = ctx?.doc?.schema;
  if (!schema || !schema.merge) {
    return false;
  }
  if (isScalar(key)) {
    return key.value === '<<' && (!key.type || key.type === Scalar.PLAIN);
  }
  return false;
}

function mergeInto(ctx, map, value) {
  const sources = isSeq(value) ? value.items : [value];
  for (const src of sources) {
    const js = isAlias(src) || isMap(src) ? toJS(src, '', ctx) : null;
    if (!js || typeof js !== 'object' || Array.isArray(js)) {
      throw new Error('Merge sources must be maps or map aliases');
    }
    const entries = js instanceof Map ? js.entries() : Object.entries(js);
    for (const [k, v] of entries) {
      if (!hasMapKey(map, k)) {
        setMapValue(map, k, v);
      }
    }
  }
}

/** Add a single pair to a JS map/object result. */
export function addPairToJSMap(ctx, map, pair) {
  const { key, value } = pair;
  if (isMergeKey(ctx, key)) {
    mergeInto(ctx, map, value);
    return map;
  }
  const jsKey = toJS(key, '', ctx);
  if (map instanceof Map) {
    map.set(jsKey, toJS(value, jsKey, ctx));
  } else if (map instanceof Set) {
    map.add(jsKey);
  } else {
    const strKey = stringifyKey(key, jsKey, ctx);
    setMapValue(map, strKey, toJS(value, strKey, ctx));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Node classes
// ---------------------------------------------------------------------------

class NodeBase {
  constructor(type) {
    defineType(this, type);
  }

  clone() {
    const copy = Object.create(Object.getPrototypeOf(this));
    defineType(copy, this[NODE_TYPE]);
    return cloneInto(this, copy);
  }

  toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    const ctx = createToJSContext(doc, { mapAsMap, maxAliasCount, onAnchor });
    const res = toJS(this, '', ctx);
    return typeof reviver === 'function'
      ? applyReviver(reviver, { '': res }, '', res)
      : res;
  }
}

export class Scalar extends NodeBase {
  constructor(value) {
    super(SCALAR);
    this.value = value;
  }

  toJSON(arg, ctx) {
    return ctx?.keep ? this.value : toJS(this.value, arg, ctx);
  }

  toString() {
    return String(this.value);
  }
}
Scalar.BLOCK_FOLDED = 'BLOCK_FOLDED';
Scalar.BLOCK_LITERAL = 'BLOCK_LITERAL';
Scalar.PLAIN = 'PLAIN';
Scalar.QUOTE_DOUBLE = 'QUOTE_DOUBLE';
Scalar.QUOTE_SINGLE = 'QUOTE_SINGLE';

function findAnchorTarget(root, alias) {
  let found;
  let done = false;
  const walk = (node) => {
    if (done || !node || typeof node !== 'object') {
      return;
    }
    if (node === alias) {
      done = true;
      return;
    }
    if (isNode(node) && node.anchor === alias.source) {
      found = node;
    }
    if (isPair(node)) {
      walk(node.key);
      walk(node.value);
    } else if (isCollection(node)) {
      node.items.forEach(walk);
    }
  };
  walk(isDocument(root) ? root.contents : root);
  return found;
}

export class Alias extends NodeBase {
  constructor(source) {
    super(ALIAS);
    this.source = source;
  }

  /** Resolve the aliased node within a Document (or node tree). */
  resolve(doc) {
    return findAnchorTarget(doc, this);
  }

  resolveInContext(ctx) {
    const node = ctx.anchorsByName.get(this.source);
    if (!node) {
      throw new ReferenceError(
        `Unresolved alias (the anchor must be set before the alias): ${this.source}`
      );
    }
    return node;
  }

  toJSON(_arg, ctx) {
    if (!ctx) {
      return { source: this.source };
    }
    const node = this.resolveInContext(ctx);
    const count = (ctx.aliasCounts.get(node) || 0) + 1;
    ctx.aliasCounts.set(node, count);
    if (ctx.maxAliasCount >= 0 && count > ctx.maxAliasCount * 10) {
      throw new ReferenceError(
        'Excessive alias count indicates a resource exhaustion attack'
      );
    }
    if (ctx.values.has(node)) {
      return ctx.values.get(node);
    }
    return toJS(node, '', ctx);
  }

  toString(ctx) {
    return stringifyNode(this, ctx);
  }
}

export class Pair {
  constructor(key, value = null) {
    defineType(this, PAIR);
    this.key = key;
    this.value = value;
  }

  clone() {
    const key = isNode(this.key) ? this.key.clone() : this.key;
    const value = isNode(this.value) ? this.value.clone() : this.value;
    return new Pair(key, value);
  }

  toJSON(_arg, ctx) {
    const pair = ctx?.mapAsMap ? new Map() : {};
    return addPairToJSMap(ctx, pair, this);
  }

  toString(ctx) {
    return stringifyNode(this, ctx);
  }
}

function keyMatches(item, key) {
  const k = isScalar(item.key) ? item.key.value : item.key;
  const want = isScalar(key) ? key.value : key;
  return k === want;
}

function unwrap(node, keepScalar) {
  return !keepScalar && isScalar(node) ? node.value : node;
}

class Collection extends NodeBase {
  constructor(type, schema) {
    super(type);
    Object.defineProperty(this, 'schema', {
      value: schema,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    this.items = [];
  }

  clone(schema) {
    const copy = super.clone();
    if (schema) {
      copy.schema = schema;
    }
    copy.items = this.items.map((it) =>
      isNode(it) || isPair(it) ? it.clone(schema) : it
    );
    return copy;
  }

  getIn(path, keepScalar) {
    const [key, ...rest] = path;
    const node = this.get(key, true);
    if (rest.length === 0) {
      return unwrap(node, keepScalar);
    }
    return isCollection(node) ? node.getIn(rest, keepScalar) : undefined;
  }

  hasIn(path) {
    const [key, ...rest] = path;
    if (rest.length === 0) {
      return this.has(key);
    }
    const node = this.get(key, true);
    return isCollection(node) ? node.hasIn(rest) : false;
  }

  setIn(path, value) {
    const [key, ...rest] = path;
    if (rest.length === 0) {
      this.set(key, value);
      return;
    }
    nestedUpdate(this, key, rest, value, 'setIn');
  }

  addIn(path, value) {
    if (path.length === 0) {
      this.add(value);
      return;
    }
    const [key, ...rest] = path;
    nestedUpdate(this, key, rest, value, 'addIn');
  }

  deleteIn(path) {
    const [key, ...rest] = path;
    if (rest.length === 0) {
      return this.delete(key);
    }
    const node = this.get(key, true);
    if (isCollection(node)) {
      return node.deleteIn(rest);
    }
    throw new Error(
      `Expected YAML collection at ${key}. Remaining path: ${rest}`
    );
  }

  toString(ctx) {
    return stringifyNode(this, ctx);
  }
}

/** Apply `method` (setIn/addIn) at `rest` below `collection.get(key)`. */
function nestedUpdate(collection, key, rest, value, method) {
  const node = collection.get(key, true);
  if (isCollection(node)) {
    node[method](rest, value);
  } else if (node === undefined) {
    collection.set(key, createNestedCollection(rest, value));
  } else {
    throw new Error(
      `Expected YAML collection at ${key}. Remaining path: ${rest}`
    );
  }
}

function createNestedCollection(path, value) {
  let v = value;
  for (let i = path.length - 1; i >= 0; i--) {
    const k = path[i];
    if (typeof k === 'number' && Number.isInteger(k) && k >= 0) {
      const arr = [];
      arr[k] = v;
      v = arr;
    } else {
      v = new Map([[k, v]]);
    }
  }
  return createNode(v);
}

export class YAMLMap extends Collection {
  static get tagName() {
    return 'tag:yaml.org,2002:map';
  }

  constructor(schema) {
    super(MAP, schema);
  }

  static from(_schema, obj, ctx) {
    return createNode(obj, ctx || {});
  }

  add(pair, overwrite) {
    const p = isPair(pair)
      ? pair
      : pair && typeof pair === 'object' && 'key' in pair
        ? new Pair(pair.key, pair.value)
        : new Pair(pair, pair?.value);
    const prev = this.items.find((it) => keyMatches(it, p.key));
    if (prev) {
      if (!overwrite) {
        throw new Error(`Key ${p.key} already set`);
      }
      prev.value =
        isScalar(prev.value) && !isNode(p.value) && !isPair(p.value)
          ? Object.assign(prev.value, { value: p.value })
          : p.value;
      return;
    }
    this.items.push(p);
  }

  delete(key) {
    const idx = this.items.findIndex((it) => keyMatches(it, key));
    if (idx === -1) {
      return false;
    }
    this.items.splice(idx, 1);
    return true;
  }

  get(key, keepScalar) {
    const it = this.items.find((item) => keyMatches(item, key));
    return it ? unwrap(it.value, keepScalar) : undefined;
  }

  has(key) {
    return this.items.some((it) => keyMatches(it, key));
  }

  set(key, value) {
    this.add(new Pair(key, value), true);
  }

  toJSON(_arg, ctx, Type) {
    const map = Type ? new Type() : ctx?.mapAsMap ? new Map() : {};
    registerValue(this, map, ctx);
    for (const item of this.items) {
      addPairToJSMap(ctx, map, item);
    }
    return map;
  }
}

function seqIndex(key) {
  const idx = isScalar(key) ? key.value : key;
  const num = typeof idx === 'string' ? Number(idx) : idx;
  return typeof num === 'number' && Number.isInteger(num) && num >= 0
    ? num
    : -1;
}

export class YAMLSeq extends Collection {
  static get tagName() {
    return 'tag:yaml.org,2002:seq';
  }

  constructor(schema) {
    super(SEQ, schema);
  }

  static from(_schema, obj, ctx) {
    return createNode(Array.from(obj ?? []), ctx || {});
  }

  add(value) {
    this.items.push(value);
  }

  delete(key) {
    const idx = seqIndex(key);
    if (idx === -1 || idx >= this.items.length) {
      return false;
    }
    this.items.splice(idx, 1);
    return true;
  }

  get(key, keepScalar) {
    const idx = seqIndex(key);
    return idx === -1 ? undefined : unwrap(this.items[idx], keepScalar);
  }

  has(key) {
    const idx = seqIndex(key);
    return idx !== -1 && idx < this.items.length;
  }

  set(key, value) {
    const idx = seqIndex(key);
    if (idx === -1) {
      throw new Error(`Expected a valid index, not ${key}.`);
    }
    const prev = this.items[idx];
    if (isScalar(prev) && !isNode(value)) {
      prev.value = value;
    } else {
      this.items[idx] = value;
    }
  }

  toJSON(_arg, ctx) {
    const seq = [];
    registerValue(this, seq, ctx);
    this.items.forEach((item, i) => {
      seq.push(toJS(item, String(i), ctx));
    });
    return seq;
  }
}

// ---------------------------------------------------------------------------
// JS value -> node tree
// ---------------------------------------------------------------------------

function unboxPrimitive(value) {
  if (
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean ||
    (typeof BigInt !== 'undefined' && value instanceof BigInt)
  ) {
    return value.valueOf();
  }
  return value;
}

function isSkippable(value) {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}

function replaceValue(ctx, holder, key, value) {
  return typeof ctx.replacer === 'function'
    ? ctx.replacer.call(holder, key, value)
    : value;
}

function allowedKey(ctx, key) {
  if (!Array.isArray(ctx.replacer)) {
    return true;
  }
  return ctx.replacer.some((k) => String(k) === String(key));
}

function createMapNode(value, ctx) {
  const map = new YAMLMap(ctx.schema);
  const entries =
    value instanceof Map ? [...value.entries()] : Object.entries(value);
  for (const [k, raw] of entries) {
    if (!allowedKey(ctx, k)) {
      continue;
    }
    const v = replaceValue(ctx, value, k, raw);
    if (isSkippable(v) && !(v === undefined && ctx.keepUndefined)) {
      continue;
    }
    map.items.push(new Pair(createNodeInner(k, ctx), createNodeInner(v, ctx)));
  }
  if (ctx.sortMapEntries) {
    map.items.sort(ctx.sortMapEntries);
  }
  return map;
}

function createSeqNode(value, ctx) {
  const seq = new YAMLSeq(ctx.schema);
  let i = 0;
  for (const raw of value) {
    const v = replaceValue(ctx, value, String(i), raw);
    i++;
    seq.items.push(createNodeInner(isSkippable(v) ? null : v, ctx));
  }
  return seq;
}

function nextAnchor(ctx) {
  const used = ctx.usedAnchors;
  let n = 1;
  while (used.has(`a${n}`)) {
    n++;
  }
  used.add(`a${n}`);
  return `a${n}`;
}

function createObjectNode(value, ctx) {
  if (ctx.aliasDuplicateObjects) {
    const seen = ctx.sourceObjects.get(value);
    if (seen) {
      if (!seen.node.anchor) {
        seen.node.anchor = nextAnchor(ctx);
      }
      return new Alias(seen.node.anchor);
    }
  }
  const entry = { node: null };
  ctx.sourceObjects.set(value, entry);
  const iterable =
    !(value instanceof Map) &&
    (Array.isArray(value) || Symbol.iterator in Object(value));
  const node = iterable ? createSeqNode(value, ctx) : createMapNode(value, ctx);
  entry.node = node;
  if (ctx.flow) {
    node.flow = true;
  }
  return node;
}

function createNodeInner(input, ctx) {
  if (isNode(input) || isPair(input)) {
    return input;
  }
  let value = unboxPrimitive(input);
  if (
    value &&
    typeof value === 'object' &&
    typeof value.toJSON === 'function' &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  ) {
    value = value.toJSON();
  }
  if (value === null || typeof value !== 'object') {
    const scalar = new Scalar(isSkippable(value) ? null : value);
    if (value === undefined && ctx.keepUndefined) {
      scalar.value = undefined;
    }
    return scalar;
  }
  return createObjectNode(value, ctx);
}

/** Create a node tree from a JS value. */
export function createNode(value, options = {}) {
  const ctx = {
    schema: options.schema,
    replacer: options.replacer,
    keepUndefined: options.keepUndefined === true,
    flow: options.flow === true,
    aliasDuplicateObjects: options.aliasDuplicateObjects !== false,
    sortMapEntries: options.sortMapEntries,
    sourceObjects: new Map(),
    usedAnchors: options.usedAnchors || new Set(),
  };
  return createNodeInner(value, ctx);
}

// ---------------------------------------------------------------------------
// Reviver (JSON.parse compatible)
// ---------------------------------------------------------------------------

export function applyReviver(reviver, obj, key, val) {
  if (val && typeof val === 'object') {
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const v = applyReviver(reviver, val, String(i), val[i]);
        if (v === undefined) {
          delete val[i];
        } else if (v !== val[i]) {
          val[i] = v;
        }
      }
    } else if (val instanceof Map) {
      for (const k of Array.from(val.keys())) {
        const v = applyReviver(reviver, val, k, val.get(k));
        if (v === undefined) {
          val.delete(k);
        } else {
          val.set(k, v);
        }
      }
    } else {
      for (const [k, v0] of Object.entries(val)) {
        const v = applyReviver(reviver, val, k, v0);
        if (v === undefined) {
          delete val[k];
        } else if (v !== v0) {
          val[k] = v;
        }
      }
    }
  }
  return reviver.call(obj, key, val);
}
