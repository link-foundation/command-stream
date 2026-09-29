// Stream level composition: split the source into documents, handle
// directives and markers, and compose each document.

import { NodeComposer } from './yaml-compose.mjs';
import { Document } from './yaml-document.mjs';
import {
  YAMLParseError,
  YAMLWarning,
  lineCounterFor,
  prettifyError,
} from './yaml-errors.mjs';

const isMarker = (line, marker) =>
  line.startsWith(marker) &&
  (line.length === 3 ||
    line[3] === ' ' ||
    line[3] === '\t' ||
    line[3] === '\r');

const isCommentOrBlank = (line) => /^[ \t\r]*(?:#.*)?$/.test(line);

function parseDirective(line, pos, state) {
  const parts = line
    .replace(/\s+#.*$/, '')
    .trim()
    .split(/[ \t]+/);
  if (parts[0] === '%YAML') {
    state.yaml = parts[1];
  } else if (parts[0] === '%TAG' && parts.length >= 3) {
    state.tags[parts[1]] = parts[2];
  } else {
    state.warnings.push(
      new YAMLWarning(
        [pos, pos + line.length],
        'BAD_DIRECTIVE',
        `Unsupported directive: ${parts[0]}`
      )
    );
  }
  state.any = true;
}

function newDirectiveState() {
  return { yaml: null, tags: {}, any: false, warnings: [], start: null };
}

/**
 * Split a YAML stream into document segments. Each segment records its
 * content range, markers and directives.
 */
export function splitDocuments(src) {
  const state = { segments: [], cur: null, directives: newDirectiveState() };
  let pos = 0;
  while (pos <= src.length) {
    const eol = src.indexOf('\n', pos);
    const line = src.slice(pos, eol === -1 ? src.length : eol);
    splitLine(state, line, pos);
    if (eol === -1) {
      break;
    }
    pos = eol + 1;
  }
  if (state.cur) {
    closeSegment(state, src.length, false);
  }
  return state.segments;
}

function closeSegment(state, end, docEnd) {
  state.cur.end = end;
  state.cur.docEnd = docEnd;
  state.segments.push(state.cur);
  state.cur = null;
}

function startSegment(state, segment) {
  state.cur = { ...segment, directives: state.directives };
  state.directives = newDirectiveState();
}

function splitLine(state, line, pos) {
  const { cur } = state;
  const inContent = cur && !cur.commentOnly;
  if (isMarker(line, '---')) {
    const pre = cur && cur.commentOnly ? cur.start : null;
    if (inContent) {
      closeSegment(state, pos, false);
    }
    startSegment(state, { docStart: true, marker: pos, start: pos + 3, pre });
  } else if (isMarker(line, '...')) {
    if (inContent) {
      closeSegment(state, pos, true);
    } else {
      state.cur = null;
    }
  } else if (line[0] === '%' && !inContent) {
    parseDirective(line, pos, state.directives);
  } else if (!cur) {
    if (line.trim() !== '') {
      const commentOnly = isCommentOrBlank(line);
      startSegment(state, { docStart: false, start: pos, commentOnly });
    }
  } else if (cur.commentOnly && !isCommentOrBlank(line)) {
    cur.commentOnly = false;
  }
}

function applyDirectives(doc, seg) {
  const d = seg.directives;
  doc.directives.docStart = seg.docStart ? true : null;
  doc.directives.docEnd = seg.docEnd === true;
  if (d.yaml) {
    doc.directives.yaml.explicit = true;
    if (d.yaml === '1.1' && doc.directives.yaml.version !== '1.1') {
      doc.setSchema('1.1');
    }
  }
  Object.assign(doc.directives.tags, d.tags);
  doc.warnings.push(...d.warnings);
}

function composeSegment(src, seg, options) {
  const doc = new Document(undefined, options);
  applyDirectives(doc, seg);
  doc.range = [seg.docStart ? seg.marker : seg.start, seg.end, seg.end];
  const composer = new NodeComposer(src, seg.start, seg.end, doc);
  try {
    if (seg.pre !== null && seg.pre !== undefined) {
      const pre = new NodeComposer(src, seg.pre, seg.marker, doc);
      const info = pre.skipToContent();
      if (info.comments.length) {
        doc.commentBefore = info.comments.map((c) => c.text).join('\n');
      }
    }
    composer.parseBody(seg.docStart);
  } catch (error) {
    if (!(error instanceof YAMLParseError)) {
      throw error;
    }
    doc.errors.push(error);
  }
  return doc;
}

/** Normalise line breaks and strip a leading byte order mark. */
export function normalizeSource(source) {
  let src = String(source ?? '');
  if (src.charCodeAt(0) === 0xfeff) {
    src = src.slice(1);
  }
  return src.replace(/\r\n/g, '\n');
}

function trailingComments(src, segments) {
  const last = segments[segments.length - 1];
  if (segments.length < 2 || !last.commentOnly || last.docStart) {
    return null;
  }
  segments.pop();
  const text = src.slice(last.start, last.end);
  return text
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^\s*#/, ''))
    .join('\n');
}

/**
 * Compose all documents in `source`. With `single`, a MULTIPLE_DOCS error is
 * added to the first document when more are present.
 */
export function composeDocuments(source, options = {}, single = false) {
  const src = normalizeSource(source);
  const segments = splitDocuments(src);
  const empty =
    segments.length === 0 || (segments.length === 1 && segments[0].commentOnly);
  const tail = trailingComments(src, segments);
  const docs = empty
    ? []
    : segments.map((seg) => composeSegment(src, seg, options));
  if (tail) {
    const last = docs[docs.length - 1];
    last.comment = last.comment ? `${last.comment}\n${tail}` : tail;
  }
  if (single && docs.length > 1) {
    const pos = segments[1].docStart ? segments[1].marker : segments[1].start;
    docs[0].errors.push(
      new YAMLParseError(
        [pos, pos + 3],
        'MULTIPLE_DOCS',
        'Source contains multiple documents; please use YAML.parseAllDocuments()'
      )
    );
  }
  if (options.prettyErrors !== false) {
    const lc = lineCounterFor(src);
    const pretty = prettifyError(src, lc);
    for (const doc of docs) {
      doc.errors.forEach(pretty);
      doc.warnings.forEach(pretty);
    }
  }
  if (options.lineCounter) {
    const lc = lineCounterFor(src);
    for (const offset of lc.lineStarts) {
      options.lineCounter.addNewLine(offset);
    }
  }
  return { docs, src };
}
