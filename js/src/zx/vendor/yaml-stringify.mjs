// Node tree -> YAML text.

import {
  isAlias,
  isCollection,
  isMap,
  isNode,
  isPair,
  isScalar,
} from './yaml-nodes.mjs';
import { stringifyNumber, stringifyString } from './yaml-stringify-scalar.mjs';
import { TAG_PREFIX } from './yaml-schema.mjs';

export const DEFAULT_TO_STRING_OPTIONS = {
  blockQuote: true,
  collectionStyle: 'any',
  defaultKeyType: null,
  defaultStringType: 'PLAIN',
  directives: null,
  doubleQuotedAsJSON: false,
  falseStr: 'false',
  flowCollectionPadding: true,
  indent: 2,
  indentSeq: true,
  lineWidth: 80,
  minContentWidth: 20,
  nullStr: 'null',
  simpleKeys: false,
  singleQuote: null,
  trueStr: 'true',
};

/** Build the root stringification context for a document. */
export function createStringifyContext(doc, options = {}) {
  const opts = { ...DEFAULT_TO_STRING_OPTIONS, ...options };
  if (!Number.isInteger(opts.indent) || opts.indent < 1) {
    throw new Error(
      `"indent" option must be a positive integer, not ${opts.indent}`
    );
  }
  return {
    doc,
    options: opts,
    indent: '',
    indentStep: ' '.repeat(opts.indent),
    inFlow: false,
    implicitKey: false,
    topLevel: true,
    parentCol: -1,
  };
}

export function tagString(tag, tags = null) {
  for (const [handle, prefix] of Object.entries(tags || {})) {
    if (
      handle !== '!!' &&
      tag.startsWith(prefix) &&
      tag.length > prefix.length
    ) {
      return `${handle}${tag.slice(prefix.length)}`;
    }
  }
  if (tag.startsWith(TAG_PREFIX)) {
    return `!!${tag.slice(TAG_PREFIX.length)}`;
  }
  if (tag.startsWith('!')) {
    return tag;
  }
  return `!<${tag}>`;
}

function propsOf(node, ctx) {
  const props = [];
  if (!isNode(node)) {
    return '';
  }
  if (node.anchor) {
    props.push(`&${node.anchor}`);
  }
  if (node.tag) {
    props.push(tagString(node.tag, ctx?.doc?.directives?.tags));
  }
  return props.join(' ');
}

export function commentLines(comment, indent) {
  return comment
    .split('\n')
    .map((line) => `${indent}#${line}`)
    .join('\n');
}

function isBlockCollection(node, ctx) {
  return (
    isCollection(node) &&
    node.items.length > 0 &&
    !ctx.inFlow &&
    !node.flow &&
    ctx.options.collectionStyle !== 'flow'
  );
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

function sourceKeepsValue(node, value, ctx) {
  const src = node?.source;
  if (typeof src !== 'string') {
    return false;
  }
  if (src === '') {
    return value === null;
  }
  const schema = ctx.doc?.schema;
  const res = schema ? schema.resolvePlain(src) : null;
  return res !== null && res.value === value;
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString(
      'base64'
    );
  }
  return globalThis.btoa(
    Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  );
}

function stringifyBinary(bytes, ctx, node) {
  const plainLike = ['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE'];
  const type = plainLike.includes(node?.type) ? node.type : 'BLOCK_LITERAL';
  let str = toBase64(bytes);
  if (type === 'BLOCK_LITERAL') {
    const width = Math.max(
      ctx.options.lineWidth - ctx.indent.length - ctx.indentStep.length,
      ctx.options.minContentWidth
    );
    const lines = [];
    for (let i = 0; i < str.length; i += width) {
      lines.push(str.slice(i, i + width));
    }
    str = lines.join('\n');
  }
  return stringifyString(str, ctx, { type });
}

function stringifyValue(value, ctx, node) {
  if (value === null || value === undefined) {
    return sourceKeepsValue(node, null, ctx)
      ? node.source
      : ctx.options.nullStr;
  }
  switch (typeof value) {
    case 'boolean':
      if (sourceKeepsValue(node, value, ctx)) {
        return node.source;
      }
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    case 'number':
    case 'bigint':
      return stringifyNumber(node, value);
    case 'string':
      return stringifyString(value, ctx, node);
    case 'object':
      if (value instanceof Uint8Array) {
        return stringifyBinary(value, ctx, node);
      }
      return stringifyString(String(value), ctx, node);
    default:
      return stringifyString(String(value), ctx, node);
  }
}

function stringifyScalar(node, ctx) {
  const props = propsOf(node, ctx);
  const valueCtx = props
    ? { ...ctx, indentAtStart: (ctx.indentAtStart ?? 0) + props.length + 1 }
    : ctx;
  const body = stringifyValue(node.value, valueCtx, node);
  let str = props ? `${props} ${body}`.trimEnd() : body;
  if (node.comment && !ctx.inFlow && !ctx.implicitKey) {
    str += `${str ? ' ' : ''}#${node.comment.replace(/\n/g, ' ')}`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

function joinItems(items, parts, ctx) {
  let out = '';
  parts.forEach((part, i) => {
    const node = isPair(items[i]) ? items[i].key : items[i];
    let decor = '';
    if (i > 0 && isNode(node) && node.spaceBefore) {
      decor += '\n';
    }
    if (i > 0) {
      decor += `\n${ctx.indent}`;
    }
    if (isNode(node) && node.commentBefore) {
      decor += `${commentLines(node.commentBefore, '').replace(/\n/g, `\n${ctx.indent}`)}\n${ctx.indent}`;
    }
    out += decor + part;
  });
  return out;
}

function childCtx(ctx, indent, extra = {}) {
  return {
    ...ctx,
    indent,
    parentCol: ctx.indent.length,
    implicitKey: false,
    topLevel: false,
    ...extra,
  };
}

function withProps(node, ctx, body) {
  const props = propsOf(node, ctx);
  if (!props) {
    return body;
  }
  return isBlockCollection(node, ctx)
    ? `${props}\n${ctx.indent}${body}`
    : `${props} ${body}`;
}

function blockSeq(seq, ctx) {
  const itemIndent = `${ctx.indent}  `;
  const parts = seq.items.map((item) => {
    const itemCtx = childCtx(ctx, itemIndent);
    return `- ${stringifyNode(item, itemCtx)}`;
  });
  return joinItems(seq.items, parts, ctx);
}

function blockMap(map, ctx) {
  const parts = map.items.map((item) =>
    stringifyPair(isPair(item) ? item : { key: item, value: null }, ctx)
  );
  return joinItems(map.items, parts, ctx);
}

function flowCollection(node, ctx) {
  const map = isMap(node);
  const [open, close] = map ? ['{', '}'] : ['[', ']'];
  const base = map ? ctx.indent : `${ctx.indent}  `;
  const itemCtx = childCtx(ctx, base + ctx.indentStep, { inFlow: true });
  const last = node.items.length - 1;
  const lines = node.items.map((item, i) => {
    const str =
      map && !isPair(item)
        ? stringifyPair({ key: item, value: null }, itemCtx)
        : stringifyNode(item, itemCtx);
    return i < last ? `${str},` : str;
  });
  const { lineWidth } = ctx.options;
  const width = lines.reduce((sum, line) => sum + line.length + 2, 2);
  const multiLine =
    lines.some((line) => line.includes('\n')) ||
    (lineWidth > 0 && width > lineWidth);
  if (!multiLine) {
    const pad = ctx.options.flowCollectionPadding ? ' ' : '';
    return `${open}${pad}${lines.join(' ')}${pad}${close}`;
  }
  const prefix = ctx.indentStep + ctx.indent;
  const body = lines.map((line) => (line ? `\n${prefix}${line}` : '\n'));
  return `${open}${body.join('')}\n${ctx.indent}${close}`;
}

function stringifyCollection(node, ctx) {
  let body;
  if (node.items.length === 0) {
    body = isMap(node) ? '{}' : '[]';
  } else if (!isBlockCollection(node, ctx)) {
    body = flowCollection(node, ctx);
  } else {
    body = isMap(node) ? blockMap(node, ctx) : blockSeq(node, ctx);
  }
  let str = withProps(node, ctx, body);
  if (node.comment && isBlockCollection(node, ctx)) {
    str += `\n${commentLines(node.comment, ctx.indent)}`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

function needsExplicitKey(key, ctx) {
  if (isCollection(key)) {
    return !ctx.inFlow && key.items.length > 0;
  }
  if (isScalar(key)) {
    return key.type === 'BLOCK_LITERAL' || key.type === 'BLOCK_FOLDED';
  }
  return false;
}

function explicitPair(key, value, ctx) {
  const inner = childCtx(ctx, `${ctx.indent}  `);
  const keyStr = stringifyNode(key, inner);
  if (value === null || value === undefined) {
    return `? ${keyStr}`;
  }
  const valueStr = stringifyNode(value, inner);
  return `? ${keyStr}\n${ctx.indent}: ${valueStr}`;
}

function valueIndentFor(value, ctx) {
  const step = ctx.indentStep;
  if (isCollection(value) && !isMap(value) && !ctx.options.indentSeq) {
    return isBlockCollection(value, ctx) ? ctx.indent : ctx.indent + step;
  }
  return ctx.indent + step;
}

export function stringifyPair(pair, ctx) {
  const { key, value } = pair;
  if (needsExplicitKey(key, ctx)) {
    return explicitPair(key, value, ctx);
  }
  const keyStr = stringifyNode(key, { ...ctx, implicitKey: true });
  if (ctx.inFlow && value === null) {
    return keyStr;
  }
  const valueIndent = valueIndentFor(value, ctx);
  const valueCtx = childCtx(ctx, valueIndent);
  if (isScalar(value) && !key?.comment) {
    valueCtx.indentAtStart = keyStr.length + 2;
  }
  const valueStr = stringifyNode(value, valueCtx);
  return joinPair(keyStr, value, valueStr, valueCtx, ctx);
}

function joinPair(keyStr, value, valueStr, valueCtx, ctx) {
  const valueIndent = valueCtx.indent;
  if (isBlockCollection(value, valueCtx) && !propsOf(value, valueCtx)) {
    return `${keyStr}:\n${valueIndent}${valueStr}`;
  }
  if (valueStr === '') {
    return `${keyStr}:`;
  }
  if (!ctx.inFlow && !isCollection(value) && value?.commentBefore) {
    const comment = commentLines(value.commentBefore, valueIndent);
    return `${keyStr}:\n${comment}\n${valueIndent}${valueStr}`;
  }
  if (valueStr[0] === '\n') {
    return `${keyStr}:${valueStr}`;
  }
  if (/^[[{]\n/.test(valueStr)) {
    return `${keyStr}:\n${valueIndent}${valueStr}`;
  }
  return `${keyStr}: ${valueStr}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Stringify any node (or raw value inside a node tree). */
export function stringifyNode(node, ctx) {
  const c = ctx && ctx.options ? ctx : createStringifyContext(ctx?.doc);
  if (isPair(node)) {
    return stringifyPair(node, c);
  }
  if (isAlias(node)) {
    return `*${node.source}`;
  }
  if (isScalar(node)) {
    return stringifyScalar(node, c);
  }
  if (isCollection(node)) {
    return stringifyCollection(node, c);
  }
  return stringifyValue(node, c, null);
}
