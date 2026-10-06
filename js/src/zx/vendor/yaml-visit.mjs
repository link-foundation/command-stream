// Node tree visitors: visit() and visitAsync() with BREAK / SKIP / REMOVE.

import {
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
} from './yaml-nodes.mjs';

const BREAK = Symbol('break visit');
const SKIP = Symbol('skip children');
const REMOVE = Symbol('remove node');

function initVisitor(visitor) {
  if (
    typeof visitor === 'object' &&
    visitor !== null &&
    (visitor.Collection || visitor.Node || visitor.Value)
  ) {
    const { Collection, Node, Value } = visitor;
    return {
      Alias: Value || Node,
      Map: Collection || Node,
      Scalar: Value || Node,
      Seq: Collection || Node,
      ...visitor,
    };
  }
  return visitor;
}

function callVisitor(key, node, path, visitor) {
  if (typeof visitor === 'function') {
    return visitor(key, node, path);
  }
  let fn;
  if (isMap(node)) {
    fn = visitor.Map;
  } else if (isSeq(node)) {
    fn = visitor.Seq;
  } else if (isPair(node)) {
    fn = visitor.Pair;
  } else if (isScalar(node)) {
    fn = visitor.Scalar;
  } else if (isAlias(node)) {
    fn = visitor.Alias;
  }
  return typeof fn === 'function' ? fn(key, node, path) : undefined;
}

function replaceNode(key, path, node) {
  const parent = path[path.length - 1];
  if (isCollection(parent)) {
    parent.items[key] = node;
  } else if (isPair(parent)) {
    if (key === 'key') {
      parent.key = node;
    } else {
      parent.value = node;
    }
  } else if (isDocument(parent)) {
    parent.contents = node;
  } else {
    const type = isAlias(parent) ? 'alias' : 'scalar';
    throw new Error(`Cannot replace node with ${type} parent`);
  }
}

const isReplacement = (ctrl) => isNode(ctrl) || isPair(ctrl);

function applyItemControl(node, i, ctrl) {
  if (typeof ctrl === 'number') {
    return ctrl - 1;
  }
  if (ctrl === REMOVE) {
    node.items.splice(i, 1);
    return i - 1;
  }
  return i;
}

/**
 * Depth-first walk as a generator: it yields `[key, node, path]` for each
 * visitor call and receives the visitor's result, so the same traversal can
 * be driven synchronously or asynchronously.
 */
function* walk(key, node, path) {
  const ctrl = yield [key, node, path];
  if (isReplacement(ctrl)) {
    replaceNode(key, path, ctrl);
    return yield* walk(key, ctrl, path);
  }
  if (typeof ctrl === 'symbol') {
    return ctrl;
  }
  const inner = Object.freeze(path.concat(node));
  if (isCollection(node)) {
    for (let i = 0; i < node.items.length; ++i) {
      const ci = yield* walk(i, node.items[i], inner);
      if (ci === BREAK) {
        return BREAK;
      }
      i = applyItemControl(node, i, ci);
    }
  } else if (isPair(node)) {
    for (const part of ['key', 'value']) {
      const cp = yield* walk(part, node[part], inner);
      if (cp === BREAK) {
        return BREAK;
      }
      if (cp === REMOVE) {
        node[part] = null;
      }
    }
  }
  return ctrl;
}

function startWalk(node) {
  return isDocument(node)
    ? walk(null, node.contents, Object.freeze([node]))
    : walk(null, node, Object.freeze([]));
}

function finishWalk(node, ctrl) {
  if (isDocument(node) && ctrl === REMOVE) {
    node.contents = null;
  }
}

/** Set up a walk; `call(step)` runs the visitor for a yielded step. */
function createWalk(node, visitor) {
  const v = initVisitor(visitor);
  const gen = startWalk(node);
  return {
    first: gen.next(),
    next: (ctrl) => gen.next(ctrl),
    call: (step) => callVisitor(...step.value, v),
  };
}

/** Walk a node tree (or Document) depth-first, calling `visitor`. */
export function visit(node, visitor) {
  const w = createWalk(node, visitor);
  let step = w.first;
  while (!step.done) {
    step = w.next(w.call(step));
  }
  finishWalk(node, step.value);
}
visit.BREAK = BREAK;
visit.SKIP = SKIP;
visit.REMOVE = REMOVE;

/** Async version of visit(); visitor functions may return promises. */
export async function visitAsync(node, visitor) {
  const w = createWalk(node, visitor);
  for (let step = w.first; ;) {
    if (step.done) {
      return finishWalk(node, step.value);
    }
    step = w.next(await w.call(step));
  }
}
visitAsync.BREAK = BREAK;
visitAsync.SKIP = SKIP;
visitAsync.REMOVE = REMOVE;
