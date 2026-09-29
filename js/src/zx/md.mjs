// Markdown → script transform for `command-stream script.md` (issue #26).
//
// Prose becomes `// ` comments, indented blocks and js/ts fences are kept as
// code, sh/bash/shell fences become an awaited `$` template and any other
// fence is commented out.

import { bufToString } from './util.mjs';

const TAB_RE = /^( {2,}|\t)/;
const FENCE_RE =
  /^(?<indent> {0,3})(?<fence>(`{3,20}|~{3,20}))(?:(?<js>js|javascript|ts|typescript)|(?<bash>sh|shell|bash)|.*)$/;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;

const fenceKind = (groups) => {
  if (groups.js) {
    return { open: '', prefix: '', close: '' };
  }
  if (groups.bash) {
    return { open: 'await $`', prefix: '', close: '`' };
  }
  return { open: '', prefix: '// ', close: '' };
};

class MarkdownScript {
  out = [];
  state = 'root';
  prevEmpty = true;
  fence = null;

  openFence(groups) {
    const char = groups.fence[0];
    const kind = fenceKind(groups);
    this.fence = {
      ...kind,
      strip: groups.indent ? new RegExp(`^ {0,${groups.indent.length}}`) : null,
      end: new RegExp(`^ {0,3}${char}{${groups.fence.length},}[ \\t]*$`),
    };
    this.out.push(kind.open);
    this.state = 'fence';
    this.prevEmpty = false;
  }

  root(line) {
    const groups = line.match(FENCE_RE)?.groups;
    if (groups?.fence) {
      this.openFence(groups);
      return;
    }
    if (this.prevEmpty && TAB_RE.test(line)) {
      this.out.push(line);
      this.state = 'tab';
      return;
    }
    this.prevEmpty = line === '';
    this.out.push(`// ${line}`);
  }

  tab(line) {
    if (line === '' || TAB_RE.test(line)) {
      this.out.push(line);
    } else {
      this.out.push(`// ${line}`);
      this.state = 'root';
    }
    this.prevEmpty = line === '';
  }

  inFence(line) {
    const { fence } = this;
    if (fence.end.test(line)) {
      this.out.push(fence.close);
      this.state = 'root';
      this.prevEmpty = true;
      this.fence = null;
      return;
    }
    const text = fence.strip ? line.replace(fence.strip, '') : line;
    this.out.push(fence.prefix + text);
    this.prevEmpty = false;
  }

  push(line) {
    if (this.state === 'fence') {
      this.inFence(line);
    } else if (this.state === 'tab') {
      this.tab(line);
    } else {
      this.root(line);
    }
  }
}

/**
 * Turn a markdown document into an executable script.
 *
 * @param {Buffer|string} buf Markdown source.
 * @returns {string} JavaScript source.
 */
export function transformMarkdown(buf) {
  const script = new MarkdownScript();
  for (const line of bufToString(buf).split(LINE_BREAK)) {
    script.push(line);
  }
  return script.out.join('\n');
}
