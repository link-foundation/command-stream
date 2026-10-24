// The Document class: a parsed or created YAML document.

import {
  Alias,
  DOC,
  NODE_TYPE,
  Pair,
  YAMLMap,
  applyReviver,
  createNode,
  createToJSContext,
  isCollection,
  isNode,
  isPair,
  isScalar,
  toJS,
} from './yaml-nodes.mjs';
import { Schema } from './yaml-schema.mjs';
import {
  commentLines,
  createStringifyContext,
  stringifyNode,
} from './yaml-stringify.mjs';

export const DEFAULT_OPTIONS = {
  intAsBigInt: false,
  keepSourceTokens: false,
  logLevel: 'warn',
  prettyErrors: true,
  strict: true,
  stringKeys: false,
  uniqueKeys: true,
  version: '1.2',
};

function splitArgs(replacer, options) {
  if (typeof replacer === 'function' || Array.isArray(replacer)) {
    return { replacer, options };
  }
  if (options === undefined && replacer && typeof replacer === 'object') {
    return { replacer: undefined, options: replacer };
  }
  return { replacer: undefined, options };
}

function collectAnchors(node, set) {
  if (!node || typeof node !== 'object') {
    return set;
  }
  if (isNode(node) && node.anchor) {
    set.add(node.anchor);
  }
  if (isCollection(node)) {
    for (const item of node.items) {
      if (isPair(item)) {
        collectAnchors(item.key, set);
        collectAnchors(item.value, set);
      } else {
        collectAnchors(item, set);
      }
    }
  }
  return set;
}

function assertCollection(contents) {
  if (isCollection(contents)) {
    return true;
  }
  throw new Error('Expected a YAML collection as document contents');
}

export class Document {
  constructor(value, replacer, options) {
    Object.defineProperty(this, NODE_TYPE, { value: DOC });
    const args = splitArgs(replacer, options);
    this.options = { ...DEFAULT_OPTIONS, ...args.options };
    this.commentBefore = null;
    this.comment = null;
    this.errors = [];
    this.warnings = [];
    this.range = null;
    const version = this.options.version === '1.1' ? '1.1' : '1.2';
    this.directives = {
      docStart: null,
      docEnd: false,
      yaml: { version, explicit: false },
      tags: { '!!': 'tag:yaml.org,2002:' },
    };
    this.schema = new Schema({ ...this.options, version });
    this.contents =
      value === undefined
        ? null
        : this.createNode(value, args.replacer, args.options);
  }

  clone() {
    const copy = Object.create(Document.prototype);
    Object.defineProperty(copy, NODE_TYPE, { value: DOC });
    Object.assign(copy, this);
    copy.errors = this.errors.slice();
    copy.warnings = this.warnings.slice();
    copy.options = { ...this.options };
    copy.directives = {
      ...this.directives,
      yaml: { ...this.directives.yaml },
      tags: { ...this.directives.tags },
    };
    copy.schema = this.schema.clone();
    copy.contents = isNode(this.contents)
      ? this.contents.clone(copy.schema)
      : this.contents;
    return copy;
  }

  /** Create a node from a JS value using this document's schema. */
  createNode(value, replacer, options) {
    const args = splitArgs(replacer, options);
    const opts = args.options || {};
    const node = createNode(value, {
      schema: this.schema,
      replacer: args.replacer,
      keepUndefined: opts.keepUndefined,
      flow: opts.flow,
      aliasDuplicateObjects: opts.aliasDuplicateObjects,
      sortMapEntries: this.schema.sortMapEntries,
      usedAnchors: collectAnchors(this.contents, new Set()),
    });
    if (opts.tag && isNode(node)) {
      node.tag = opts.tag;
    }
    return node;
  }

  createPair(key, value, options = {}) {
    return new Pair(
      this.createNode(key, null, options),
      this.createNode(value, null, options)
    );
  }

  createAlias(node, name) {
    if (!node.anchor) {
      const used = collectAnchors(this.contents, new Set());
      let n = 1;
      while (used.has(`${name || 'a'}${n}`)) {
        n++;
      }
      node.anchor = name && !used.has(name) ? name : `${name || 'a'}${n}`;
    }
    return new Alias(node.anchor);
  }

  add(value) {
    if (assertCollection(this.contents)) {
      this.contents.add(value);
    }
  }

  addIn(path, value) {
    if (path.length === 0) {
      this.add(value);
    } else if (this.contents === null || this.contents === undefined) {
      this.contents = this.createNode(new Map());
      this.contents.addIn(path, value);
    } else if (assertCollection(this.contents)) {
      this.contents.addIn(path, value);
    }
  }

  delete(key) {
    return isCollection(this.contents) ? this.contents.delete(key) : false;
  }

  deleteIn(path) {
    if (!path || path.length === 0) {
      if (this.contents === null) {
        return false;
      }
      this.contents = null;
      return true;
    }
    return isCollection(this.contents) ? this.contents.deleteIn(path) : false;
  }

  get(key, keepScalar) {
    return isCollection(this.contents)
      ? this.contents.get(key, keepScalar)
      : undefined;
  }

  getIn(path, keepScalar) {
    if (!path || path.length === 0) {
      return !keepScalar && isScalar(this.contents)
        ? this.contents.value
        : this.contents;
    }
    return isCollection(this.contents)
      ? this.contents.getIn(path, keepScalar)
      : undefined;
  }

  has(key) {
    return isCollection(this.contents) ? this.contents.has(key) : false;
  }

  hasIn(path) {
    if (!path || path.length === 0) {
      return this.contents !== undefined;
    }
    return isCollection(this.contents) ? this.contents.hasIn(path) : false;
  }

  set(key, value) {
    if (this.contents === null || this.contents === undefined) {
      this.contents = new YAMLMap(this.schema);
    }
    if (assertCollection(this.contents)) {
      this.contents.set(key, value);
    }
  }

  setIn(path, value) {
    if (!path || path.length === 0) {
      this.contents = value;
      return;
    }
    if (this.contents === null || this.contents === undefined) {
      this.contents = new YAMLMap(this.schema);
    }
    if (assertCollection(this.contents)) {
      this.contents.setIn(path, value);
    }
  }

  setSchema(version, options = {}) {
    const v = version === '1.1' ? '1.1' : '1.2';
    this.directives.yaml.version = v;
    this.schema = new Schema({ ...this.options, ...options, version: v });
  }

  /** Convert the document contents into plain JavaScript values. */
  toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    const ctx = createToJSContext(this, {
      mapAsMap: mapAsMap === true,
      maxAliasCount: typeof maxAliasCount === 'number' ? maxAliasCount : 100,
    });
    ctx.keep = !json;
    const res = toJS(this.contents, jsonArg ?? '', ctx);
    if (typeof onAnchor === 'function') {
      for (const [name, node] of ctx.anchorsByName) {
        onAnchor(ctx.values.get(node), ctx.aliasCounts.get(node) || 0, name);
      }
    }
    return typeof reviver === 'function'
      ? applyReviver(reviver, { '': res }, '', res)
      : res;
  }

  toJSON(jsonArg, onAnchor) {
    return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
  }

  /** Stringify the document as YAML text. */
  toString(options = {}) {
    if (this.errors.length > 0) {
      throw new Error('Document with errors cannot be stringified');
    }
    const ctx = createStringifyContext(this, {
      ...this.schema.toStringOptions,
      ...options,
    });
    return stringifyDocument(this, ctx);
  }
}

function directiveLines(doc, ctx) {
  const lines = [];
  const { directives } = doc;
  const want = ctx.options.directives;
  if (want === false) {
    return lines;
  }
  if (directives.yaml.explicit) {
    lines.push(`%YAML ${directives.yaml.version}`);
  }
  for (const [handle, prefix] of Object.entries(directives.tags)) {
    if (handle !== '!!' || prefix !== 'tag:yaml.org,2002:') {
      lines.push(`%TAG ${handle} ${prefix}`);
    }
  }
  return lines;
}

function isBlockScalarText(str) {
  return /^[|>][1-9]?[-+]?\n/.test(str);
}

function contentLines(doc, ctx, docStart) {
  const { contents } = doc;
  if (contents === null || contents === undefined) {
    return [docStart ? '' : ctx.options.nullStr];
  }
  const node = isNode(contents) ? contents : doc.createNode(contents);
  return [stringifyNode(node, ctx)];
}

function bodyLines(doc, ctx, docStart) {
  const [body] = contentLines(doc, ctx, docStart);
  const lead = isNode(doc.contents) ? doc.contents.commentBefore : null;
  if (docStart && isBlockScalarText(body) && !lead) {
    return [`--- ${body}`];
  }
  const lines = docStart ? ['---'] : [];
  if (lead) {
    lines.push(commentLines(lead, ''));
  }
  lines.push(body);
  return lines;
}

function stringifyDocument(doc, ctx) {
  const lines = [];
  const directives = directiveLines(doc, ctx);
  const docStart =
    ctx.options.directives !== false &&
    (doc.directives.docStart === true ||
      directives.length > 0 ||
      ctx.options.directives === true);
  if (doc.commentBefore) {
    lines.push(commentLines(doc.commentBefore, ''));
    if (!docStart) {
      lines.push('');
    }
  }
  lines.push(...directives);
  lines.push(...bodyLines(doc, ctx, docStart));
  if (doc.directives.docEnd) {
    lines.push(doc.comment ? `... ${commentLines(doc.comment, '')}` : '...');
  } else if (doc.comment) {
    if (lines[lines.length - 1] !== '') {
      lines.push('');
    }
    lines.push(commentLines(doc.comment, ''));
  }
  return `${lines.join('\n')}\n`;
}
