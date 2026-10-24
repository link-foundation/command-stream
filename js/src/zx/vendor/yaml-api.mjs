// Named exports of the YAML implementation (see yaml.mjs for the entry point).

import { composeDocuments } from './yaml-compose-docs.mjs';
import { CST, Composer, Lexer, Parser } from './yaml-cst.mjs';
import { Document } from './yaml-document.mjs';
import {
  LineCounter,
  YAMLError,
  YAMLParseError,
  YAMLWarning,
  emitWarning,
} from './yaml-errors.mjs';
import {
  Alias,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
} from './yaml-nodes.mjs';
import { Schema } from './yaml-schema.mjs';
import { visit, visitAsync } from './yaml-visit.mjs';

/** Parse every document in `source`; the result has `.empty` if none. */
export function parseAllDocuments(source, options = {}) {
  const { docs } = composeDocuments(source, options || {});
  if (docs.length === 0) {
    const empty = [];
    return Object.assign(empty, { empty: true });
  }
  return docs;
}

/** Parse a single document; extra documents add a MULTIPLE_DOCS error. */
export function parseDocument(source, options = {}) {
  const { docs } = composeDocuments(source, options || {}, true);
  if (docs.length === 0) {
    return new Document(undefined, options || {});
  }
  return docs[0];
}

/** Parse a YAML string into plain JavaScript values. */
export function parse(src, reviver, options) {
  let fn;
  let opts = options;
  if (typeof reviver === 'function') {
    fn = reviver;
  } else if (opts === undefined && reviver && typeof reviver === 'object') {
    opts = reviver;
  }
  const doc = parseDocument(src, opts || {});
  for (const warning of doc.warnings) {
    emitWarning(warning, doc.options.logLevel);
  }
  if (doc.errors.length > 0) {
    if (doc.options.logLevel !== 'silent') {
      throw doc.errors[0];
    }
    doc.errors = [];
  }
  return doc.toJS({ reviver: fn, ...opts });
}

function normalizeStringifyOptions(opts) {
  const value = typeof opts === 'string' ? opts.length : opts;
  if (typeof value !== 'number') {
    return value;
  }
  const indent = Math.round(value);
  if (indent < 1) {
    return undefined;
  }
  return { indent: Math.min(indent, 8) };
}

/** Stringify a JavaScript value (or Document) as YAML. */
export function stringify(value, replacer, options) {
  let fn = null;
  let opts = options;
  if (typeof replacer === 'function' || Array.isArray(replacer)) {
    fn = replacer;
  } else if (opts === undefined && replacer) {
    opts = replacer;
  }
  opts = normalizeStringifyOptions(opts);
  if (value === undefined && !(opts ?? {}).keepUndefined) {
    return undefined;
  }
  if (isDocument(value) && !fn) {
    return value.toString(opts);
  }
  return new Document(value, fn, opts).toString(opts);
}

export {
  Alias,
  CST,
  Composer,
  Document,
  Lexer,
  LineCounter,
  Pair,
  Parser,
  Scalar,
  Schema,
  YAMLError,
  YAMLMap,
  YAMLParseError,
  YAMLSeq,
  YAMLWarning,
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  visit,
  visitAsync,
};
