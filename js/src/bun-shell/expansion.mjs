// Word expansion, ported from Bun's `Expansion` state
// (src/runtime/shell/states/Expansion.rs): variables, `$0..$9`, tilde,
// command substitution with word splitting, brace expansion and globbing.
//
// The result mirrors Bun's `ExpansionResult`: `buf` holds the expanded words
// back to back and `bounds` the offsets where a new word starts, so a single
// word (no bounds) can be told apart from several (possibly empty) words.

import {
  BraceError,
  MAX_BRACE_EXPANSIONS,
  calculateExpandedAmount,
  expand as braceExpand,
  tokenize as braceTokenize,
} from './braces.mjs';
import { globWalkSync } from './glob.mjs';
import { ShellSysError } from './io.mjs';
import { atomHasBraceExpansion, atomHasGlobExpansion } from './parser.mjs';

const IS_WINDOWS = process.platform === 'win32';
const TRIM_CHARS = ' \n\r\t';

/** Bun's `ShellErr::Custom`: displayed as "bun: {message}". */
export class ShellCustomError extends Error {
  display() {
    return `bun: ${this.message}`;
  }
}

/** Split an expansion result into its words. */
export function expansionWords(result) {
  const words = [];
  let start = 0;
  for (const end of result.bounds) {
    words.push(result.buf.slice(start, end));
    start = end;
  }
  words.push(result.buf.slice(start));
  return words;
}

function trimEnd(s) {
  let hi = s.length;
  while (hi > 0 && TRIM_CHARS.includes(s[hi - 1])) {
    hi--;
  }
  return s.slice(0, hi);
}

function trim(s) {
  let lo = 0;
  while (lo < s.length && TRIM_CHARS.includes(s[lo])) {
    lo++;
  }
  return trimEnd(s.slice(lo));
}

function isSep(ch) {
  return ch === '/' || (IS_WINDOWS && ch === '\\');
}

/** Escape non-meta characters so the glob walker matches them literally. */
function neutralizeGlobMetachars(currentOut, metaOffsets) {
  let pattern = '';
  let nextMeta = 0;
  for (let i = 0; i < currentOut.length; i++) {
    const ch = currentOut[i];
    if (nextMeta < metaOffsets.length && metaOffsets[nextMeta] === i) {
      nextMeta++;
      pattern += ch;
      continue;
    }
    if ('*?[]{},'.includes(ch)) {
      pattern += `[${ch}]`;
    } else if (ch === '!') {
      pattern +=
        pattern.length === 0 || isSep(pattern[pattern.length - 1])
          ? '{!}'
          : '!';
    } else if (ch === '\\' && !IS_WINDOWS) {
      pattern += '[\\\\]';
    } else {
      pattern += ch;
    }
  }
  return pattern;
}

class Expansion {
  constructor(atom, ctx) {
    this.atom = atom;
    this.ctx = ctx;
    this.shell = ctx.shell;
    this.buf = '';
    this.bounds = [];
    this.currentOut = '';
    this.metaOffsets = [];
    this.hasQuotedEmpty = false;
    this.outExitCode = null;
  }

  pushCurrentOut() {
    if (this.buf.length > 0) {
      this.bounds.push(this.buf.length);
    }
    this.buf += this.currentOut;
    this.currentOut = '';
    this.metaOffsets = [];
  }

  pushWord(word) {
    if (this.buf.length > 0) {
      this.bounds.push(this.buf.length);
    }
    this.buf += word;
  }

  expandSimple(simple) {
    switch (simple.t) {
      case 'Text':
        this.currentOut += simple.text;
        break;
      case 'QuotedEmpty':
        this.hasQuotedEmpty = true;
        break;
      case 'Var':
        this.currentOut += this.shell.getVar(simple.name) ?? '';
        break;
      case 'VarArgv':
        this.currentOut += this.ctx.argv?.[simple.n] ?? '';
        break;
      case 'Asterisk':
        this.metaOffsets.push(this.currentOut.length);
        this.currentOut += '*';
        break;
      case 'DoubleAsterisk':
        this.metaOffsets.push(
          this.currentOut.length,
          this.currentOut.length + 1
        );
        this.currentOut += '**';
        break;
      case 'BraceBegin':
      case 'BraceEnd':
      case 'Comma':
        this.metaOffsets.push(this.currentOut.length);
        this.currentOut += { BraceBegin: '{', BraceEnd: '}', Comma: ',' }[
          simple.t
        ];
        break;
      case 'Tilde':
        this.currentOut += this.shell.getHomedir();
        break;
      default:
        throw new Error(`unknown atom: ${simple.t}`);
    }
  }

  async cmdSubst(simple) {
    const { exitCode, stdout } = await this.ctx.runCmdSubst(
      simple.script,
      this.shell
    );
    if (exitCode !== 0 && this.atom.type === 'simple') {
      this.outExitCode = exitCode;
    }
    if (simple.quoted || this.ctx.assignCtx) {
      this.currentOut += trimEnd(stdout);
    } else {
      this.postSubshellExpansion(stdout);
    }
  }

  /** Word splitting of an unquoted command substitution. */
  postSubshellExpansion(stdout) {
    let out = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
    out = trim(out.replaceAll('\n', ' '));
    if (out.length === 0) {
      return;
    }
    let prevWs = false;
    let a = 0;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (prevWs) {
        if (c !== ' ') {
          a = i;
          prevWs = false;
        }
        continue;
      }
      if (c === ' ') {
        prevWs = true;
        this.currentOut += out.slice(a, i);
        this.pushCurrentOut();
      }
    }
    this.currentOut += out.slice(a);
  }

  expandLeadingTilde() {
    const home = this.shell.getHomedir();
    const before = this.currentOut.length;
    const first = this.currentOut[0];
    if (first === '/' || first === '\\') {
      this.currentOut = home + this.currentOut;
    } else if (first !== undefined) {
      this.currentOut = `~${this.currentOut}`;
    } else if (this.hasQuotedEmpty) {
      this.currentOut = home;
    }
    const prepended = this.currentOut.length - before;
    if (prepended !== 0) {
      this.metaOffsets = this.metaOffsets.map((o) => o + prepended);
    }
  }

  braceExpand() {
    let escaped = '';
    let nextMeta = 0;
    for (let i = 0; i < this.currentOut.length; i++) {
      const ch = this.currentOut[i];
      if (
        nextMeta < this.metaOffsets.length &&
        this.metaOffsets[nextMeta] === i
      ) {
        nextMeta++;
      } else if ('{},\\'.includes(ch)) {
        escaped += '\\';
      }
      escaped += ch;
    }
    const { tokens, containsNested } = braceTokenize(escaped);
    const count = calculateExpandedAmount(tokens);
    if (count > MAX_BRACE_EXPANSIONS) {
      throw new ShellCustomError(
        `too many brace expansions (${count} > ${MAX_BRACE_EXPANSIONS})`
      );
    }
    let expanded;
    if (count === 0) {
      expanded = [this.currentOut];
    } else {
      try {
        expanded = braceExpand(tokens, count, containsNested);
      } catch (e) {
        if (e instanceof BraceError && e.kind === 'TooManyBraces') {
          throw new ShellCustomError('too many braces in brace expansion');
        }
        throw e;
      }
    }
    for (const word of expanded) {
      this.pushWord(word);
    }
  }

  glob() {
    const pattern = neutralizeGlobMetachars(this.currentOut, this.metaOffsets);
    let entries = [];
    let walkErr = null;
    try {
      entries = globWalkSync(pattern, {
        cwd: this.shell.cwd,
        dot: false,
        absolute: false,
        followSymlinks: false,
        throwErrorOnBrokenSymlink: false,
        onlyFiles: false,
      });
    } catch (e) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') {
        walkErr = e;
      }
      entries = [];
    }
    if (entries.length === 0 || walkErr) {
      if (this.ctx.isAssign) {
        this.pushCurrentOut();
        return;
      }
      if (walkErr) {
        if (typeof walkErr.code === 'string' && walkErr.code.startsWith('E')) {
          throw new ShellSysError(walkErr.code, {
            path: walkErr.path ?? '',
            syscall: walkErr.syscall ?? '',
          });
        }
        throw new ShellCustomError(String(walkErr?.message ?? walkErr));
      }
      throw new ShellCustomError(`no matches found: ${this.currentOut}`);
    }
    for (const entry of entries) {
      this.pushWord(entry);
    }
  }

  async run() {
    const atom = this.atom;
    const atoms = atom.type === 'simple' ? [atom.atom] : atom.atoms;
    const leadingTilde = atom.type === 'compound' && atoms[0]?.t === 'Tilde';
    for (let i = leadingTilde ? 1 : 0; i < atoms.length; i++) {
      if (atoms[i].t === 'CmdSubst') {
        await this.cmdSubst(atoms[i]);
      } else {
        this.expandSimple(atoms[i]);
      }
    }
    if (leadingTilde) {
      this.expandLeadingTilde();
    }
    if (atomHasBraceExpansion(atom)) {
      this.braceExpand();
      if (atomHasGlobExpansion(atom)) {
        this.glob();
      }
      return;
    }
    if (atomHasGlobExpansion(atom)) {
      this.glob();
      return;
    }
    this.pushCurrentOut();
  }
}

/**
 * Expand one atom.
 *
 * @param {object} atom parser Atom
 * @param {{shell, runCmdSubst: (script, shell) => Promise<{exitCode, stdout}>,
 *          argv?: string[], isAssign?: boolean, assignCtx?: boolean}} ctx
 *   `isAssign`: the atom is the value of an assignment (a failed glob keeps
 *   the pattern); `assignCtx`: command substitutions are not word-split
 * @returns {Promise<{buf: string, bounds: number[], outExitCode: number|null,
 *          hasQuotedEmpty: boolean}>} rejects with a ShellSysError or
 *   ShellCustomError
 */
export async function expandAtom(atom, ctx) {
  const e = new Expansion(atom, ctx);
  await e.run();
  return {
    buf: e.buf,
    bounds: e.bounds,
    outExitCode: e.outExitCode,
    hasQuotedEmpty: e.hasQuotedEmpty,
  };
}
