// Bun Shell parser, ported from Bun's src/shell_parser/parse.rs (`Parser`).
//
// AST (plain objects):
//   Script    { stmts: Stmt[] }
//   Stmt      { exprs: Expr[] }
//   Expr      { type: 'assign', assigns: Assign[] }
//             { type: 'binary', op: 'and' | 'or', left, right }
//             { type: 'pipeline', items: Expr[] }   (assign/cmd/subshell/if/condexpr)
//             { type: 'cmd', assigns, nameAndArgs: Atom[], redirect: flags, redirectFile }
//             { type: 'subshell', script, redirect, redirectFlags }
//             { type: 'if', cond: Stmt[], then: Stmt[], elseParts: Stmt[][] }
//             { type: 'condexpr', op: string, args: Atom[] }
//   Assign    { label: string, value: Atom }
//   Atom      { type: 'simple', atom: SimpleAtom }
//             { type: 'compound', atoms: SimpleAtom[], braceExpansionHint, globHint }
//   SimpleAtom{ t: 'Var', name } | { t: 'VarArgv', n } | { t: 'Text', text }
//             | { t: 'QuotedEmpty' | 'Asterisk' | 'DoubleAsterisk' | 'BraceBegin'
//                  | 'BraceEnd' | 'Comma' | 'Tilde' }
//             | { t: 'CmdSubst', script, quoted }
//   Redirect  { type: 'atom', atom } | { type: 'jsbuf', idx }

import { lex, LexDepthError, RedirectFlags } from './lexer.mjs';

// Conditional expression operators known to the parser, and the supported ones.
const SUPPORTED_COND_OPS = new Set(['-f', '-z', '-n', '-d', '-c', '==', '!=']);
const SINGLE_ARG_OPS = [
  '-a',
  '-b',
  '-c',
  '-d',
  '-e',
  '-f',
  '-g',
  '-h',
  '-k',
  '-p',
  '-r',
  '-s',
  '-t',
  '-u',
  '-w',
  '-x',
  '-G',
  '-L',
  '-N',
  '-O',
  '-S',
  '-o',
  '-v',
  '-R',
  '-z',
  '-n',
];
const BINARY_OPS = [
  '-ef',
  '-nt',
  '-ot',
  '==',
  '!=',
  '<',
  '>',
  '-eq',
  '-ne',
  '-lt',
  '-le',
  '-gt',
  '-ge',
];

const IF_CLAUSE_TOKS = new Set(['if', 'else', 'elif', 'then', 'fi']);

const VARARGV = ['$0', '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'];

/** Token#as_human_readable */
export function tokenHumanReadable(tok, strpool) {
  switch (tok.t) {
    case 'Pipe':
      return '`|`';
    case 'DoublePipe':
      return '`||`';
    case 'Ampersand':
      return '`&`';
    case 'DoubleAmpersand':
      return '`&&`';
    case 'Redirect':
      return '`>`';
    case 'Asterisk':
      return '`*`';
    case 'DoubleAsterisk':
      return '`**`';
    case 'Semicolon':
      return '`;`';
    case 'Newline':
      return '`\\n`';
    case 'BraceBegin':
      return '`{`';
    case 'Comma':
      return '`,`';
    case 'BraceEnd':
      return '`}`';
    case 'CmdSubstBegin':
      return '`$(`';
    case 'CmdSubstQuoted':
      return 'CmdSubstQuoted';
    case 'CmdSubstEnd':
      return '`)`';
    case 'OpenParen':
      return '`(`';
    case 'CloseParen':
      return '`)';
    case 'Var':
    case 'Text':
    case 'SingleQuotedText':
    case 'DoubleQuotedText':
      return strpool.slice(tok.start, tok.end);
    case 'VarArgv':
      return VARARGV[tok.n];
    case 'JSObjRef':
      return 'JSObjRef';
    case 'DoubleBracketOpen':
      return '[[';
    case 'DoubleBracketClose':
      return ']]';
    case 'Delimit':
      return 'Delimit';
    case 'Eof':
      return 'EOF';
    default:
      return tok.t;
  }
}

export function isValidVarName(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

const isBraceAtom = (a) => a.t === 'BraceBegin' || a.t === 'BraceEnd';
const isGlobAtom = (a) => a.t === 'Asterisk' || a.t === 'DoubleAsterisk';

/** ast::Atom::merge */
function mergeAtoms(left, right) {
  const latoms = left.type === 'simple' ? [left.atom] : left.atoms;
  const ratoms = right.type === 'simple' ? [right.atom] : right.atoms;
  const hint = (atom, pred, key) =>
    atom.type === 'simple' ? pred(atom.atom) : atom[key];
  return {
    type: 'compound',
    atoms: [...latoms, ...ratoms],
    braceExpansionHint:
      hint(left, isBraceAtom, 'braceExpansionHint') ||
      hint(right, isBraceAtom, 'braceExpansionHint'),
    globHint:
      hint(left, isGlobAtom, 'globHint') || hint(right, isGlobAtom, 'globHint'),
  };
}

export function atomHasGlobExpansion(atom) {
  return atom.type === 'simple' ? isGlobAtom(atom.atom) : atom.globHint;
}

export function atomHasBraceExpansion(atom) {
  return atom.type === 'compound' && atom.braceExpansionHint;
}

export function atomsLen(atom) {
  return atom.type === 'simple' ? 1 : atom.atoms.length;
}

/** Signals that parsing failed; the messages are in `parser.errors`. */
class ParseFailure extends Error {}

export class Parser {
  constructor(lexResult) {
    this.strpool = lexResult.strpool;
    this.tokens = lexResult.tokens;
    this.jsStringRanges = lexResult.jsStringRanges;
    this.current = 0;
    this.errors = [];
    this.insideSubshell = null; // null | 'CmdSubst' | 'Normal'
  }

  fail(msg) {
    this.errors.push(msg);
    throw new ParseFailure(msg);
  }

  closingTok() {
    return this.insideSubshell === 'CmdSubst' ? 'CmdSubstEnd' : 'CloseParen';
  }

  makeSubparser(kind) {
    const sub = new Parser({
      strpool: this.strpool,
      tokens: this.tokens,
      jsStringRanges: this.jsStringRanges,
    });
    sub.current = this.current;
    sub.errors = this.errors;
    sub.insideSubshell = kind;
    return sub;
  }

  continueFromSubparser(sub) {
    this.current =
      sub.current >= this.tokens.length ? sub.current : sub.current + 1;
  }

  runSubparser(kind) {
    const sub = this.makeSubparser(kind);
    let script;
    try {
      script = sub.parseImpl();
    } finally {
      this.continueFromSubparser(sub);
    }
    return script;
  }

  parse() {
    return this.parseImpl();
  }

  parseImpl() {
    const stmts = [];
    if (
      this.tokens.length === 0 ||
      (this.tokens.length === 1 && this.tokens[0].t === 'Eof')
    ) {
      return { stmts };
    }
    const ends =
      this.insideSubshell === null ? ['Eof'] : ['Eof', this.closingTok()];
    while (!this.matchAny(ends)) {
      this.skipNewlines();
      stmts.push(this.parseStmt());
      this.skipNewlines();
    }
    this.expectAny(ends);
    return { stmts };
  }

  stmtEnds() {
    return this.insideSubshell === null
      ? ['Semicolon', 'Newline', 'Eof']
      : ['Semicolon', 'Newline', 'Eof', this.closingTok()];
  }

  parseStmt() {
    const exprs = [];
    const ends = this.stmtEnds();
    while (!this.matchAny(ends)) {
      const expr = this.parseExpr();
      if (this.match('Ampersand')) {
        this.fail('Background commands "&" are not supported yet.');
      }
      exprs.push(expr);
    }
    return { exprs };
  }

  parseExpr() {
    return this.parseBinary();
  }

  parseBinary() {
    let left = this.parsePipeline();
    while (this.matchAny(['DoubleAmpersand', 'DoublePipe'])) {
      const op = this.prev().t === 'DoubleAmpersand' ? 'and' : 'or';
      const right = this.parsePipeline();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  asPipelineItem(expr) {
    if (['assign', 'cmd', 'subshell', 'if', 'condexpr'].includes(expr.type)) {
      return expr;
    }
    return this.fail(
      `Expected a command, assignment, or subshell but got: ${expr.type}`
    );
  }

  parsePipeline() {
    let expr = this.parseCompoundCmd();
    if (this.peek().t === 'Pipe') {
      const items = [this.asPipelineItem(expr)];
      while (this.match('Pipe')) {
        expr = this.parseCompoundCmd();
        items.push(this.asPipelineItem(expr));
      }
      return { type: 'pipeline', items };
    }
    return expr;
  }

  expectIfClauseTextToken(name) {
    const tok = this.peek();
    if (
      tok.t === 'Text' &&
      this.delimits(this.peekN(1)) &&
      this.text(tok) === name
    ) {
      const t = this.advance();
      this.expectDelimit();
      return t;
    }
    throw new Error(`Expected: ${name}`);
  }

  isIfClauseTextToken(name) {
    const tok = this.peek();
    return (
      tok.t === 'Text' &&
      this.delimits(this.peekN(1)) &&
      this.ifClauseTokAt(tok) === name
    );
  }

  skipNewlines() {
    while (this.match('Newline')) {
      // skip
    }
  }

  parseCompoundCmd() {
    if (this.peek().t === 'OpenParen') {
      const subshell = this.parseSubshell();
      if (subshell.redirectFlags !== 0) {
        this.fail(
          'Subshells with redirections are currently not supported. Please open a GitHub issue.'
        );
      }
      return subshell;
    }
    if (this.isIfClauseTextToken('if')) {
      return this.parseIfClause();
    }
    if (this.peek().t === 'DoubleBracketOpen') {
      return this.parseCondExpr();
    }
    return this.parseSimpleCmd();
  }

  parseSubshell() {
    this.expect('OpenParen');
    const script = this.runSubparser('Normal');
    const parsed = this.parseRedirect();
    return {
      type: 'subshell',
      script,
      redirect: parsed.redirect,
      redirectFlags: parsed.flags,
    };
  }

  expectCondArg(prefix) {
    const arg = this.parseAtom();
    if (!arg) {
      this.fail(`${prefix}${tokenHumanReadable(this.peek(), this.strpool)}`);
    }
    return arg;
  }

  expectDoubleBracketClose() {
    if (!this.match('DoubleBracketClose')) {
      this.fail(
        `Expected "]]" but got: ${tokenHumanReadable(this.peek(), this.strpool)}`
      );
    }
  }

  checkCondOpSupported(name) {
    if (!SUPPORTED_COND_OPS.has(name)) {
      this.fail(
        `Conditional expression operation: ${name}, is not supported right now. Please open a GitHub issue if you would like it to be supported.`
      );
    }
  }

  parseCondExpr() {
    this.expect('DoubleBracketOpen');
    const first = this.peek();
    if (first.t === 'Text') {
      const txt = this.text(first);
      if (txt[0] === '-') {
        if (SINGLE_ARG_OPS.includes(txt)) {
          this.checkCondOpSupported(txt);
          this.expect('Text');
          if (!this.match('Delimit')) {
            this.fail('Expected a single, simple word');
          }
          const arg = this.expectCondArg('Expected a word, but got: ');
          this.expectDoubleBracketClose();
          return { type: 'condexpr', op: txt, args: [arg] };
        }
        this.fail(`Unknown conditional expression operation: ${txt}`);
      }
    }
    const arg1 = this.expectCondArg(
      'Expected a conditional expression operand, but got: '
    );
    if (this.peek().t !== 'Text') {
      this.fail(
        `Expected a conditional expression operator, but got: ${tokenHumanReadable(this.peek(), this.strpool)}`
      );
    }
    const opTok = this.expect('Text');
    if (!this.match('Delimit')) {
      this.fail('Expected a single, simple word');
    }
    const txt = this.text(opTok);
    if (BINARY_OPS.includes(txt)) {
      this.checkCondOpSupported(txt);
      const arg2 = this.expectCondArg('Expected a word, but got: ');
      this.expectDoubleBracketClose();
      return { type: 'condexpr', op: txt, args: [arg1, arg2] };
    }
    return this.fail(`Unknown conditional expression operation: ${txt}`);
  }

  parseIfBody(until) {
    const ret = [];
    const ends =
      this.insideSubshell === null ? ['Eof'] : [this.closingTok(), 'Eof'];
    while (!this.peekAnyIfClauseTok(until) && !this.peekAny(ends)) {
      this.skipNewlines();
      ret.push(this.parseStmt());
      this.skipNewlines();
    }
    return ret;
  }

  expectIfKeyword(name) {
    if (!this.matchIfClauseTok(name)) {
      this.fail(`Expected "${name}" but got: ${this.peek().t}`);
    }
  }

  parseIfClause() {
    this.expectIfClauseTextToken('if');
    const cond = this.parseIfBody(['then']);
    this.expectIfKeyword('then');
    const then = this.parseIfBody(['else', 'elif', 'fi']);
    const elseParts = [];
    const tok = this.ifClauseTokFromTok(this.peek());
    if (tok === null || tok === 'if' || tok === 'then') {
      this.fail(`Expected "else", "elif", or "fi" but got: ${this.peek().t}`);
    }
    if (tok === 'else') {
      this.expectIfClauseTextToken('else');
      const elsePart = this.parseIfBody(['fi']);
      this.expectIfKeyword('fi');
      elseParts.push(elsePart);
      return { type: 'if', cond, then, elseParts };
    }
    if (tok === 'elif') {
      for (;;) {
        this.expectIfClauseTextToken('elif');
        const elifCond = this.parseIfBody(['then']);
        this.expectIfKeyword('then');
        const thenPart = this.parseIfBody(['elif', 'else', 'fi']);
        elseParts.push(elifCond, thenPart);
        const next = this.ifClauseTokFromTok(this.peek());
        if (next === 'elif') {
          continue;
        }
        if (next === 'else') {
          this.expectIfClauseTextToken('else');
          elseParts.push(this.parseIfBody(['fi']));
        }
        break;
      }
      this.expectIfKeyword('fi');
      return { type: 'if', cond, then, elseParts };
    }
    this.expectIfClauseTextToken('fi');
    return { type: 'if', cond, then, elseParts: [] };
  }

  parseSimpleCmd() {
    const assigns = [];
    const ends = this.stmtEnds();
    while (!this.checkAny(ends)) {
      const assign = this.parseAssign();
      if (!assign) {
        break;
      }
      assigns.push(assign);
    }
    if (this.checkAny(ends)) {
      if (assigns.length === 0) {
        this.fail('expected a command or assignment');
      }
      return { type: 'assign', assigns };
    }
    const name = this.parseAtom();
    if (!name) {
      if (assigns.length === 0) {
        this.fail(
          `expected a command or assignment but got: "${this.peek().t}"`
        );
      }
      return { type: 'assign', assigns };
    }
    const nameAndArgs = [name];
    for (let arg = this.parseAtom(); arg; arg = this.parseAtom()) {
      nameAndArgs.push(arg);
    }
    const parsed = this.parseRedirect();
    return {
      type: 'cmd',
      assigns,
      nameAndArgs,
      redirectFile: parsed.redirect,
      redirect: parsed.flags,
    };
  }

  parseRedirect() {
    const hasRedirect = this.match('Redirect');
    const flags = hasRedirect ? this.prev().flags : 0;
    let redirect = null;
    if (hasRedirect) {
      if (this.match('JSObjRef')) {
        redirect = { type: 'jsbuf', idx: this.prev().idx };
      } else {
        const file = this.parseAtom();
        if (file) {
          redirect = { type: 'atom', atom: file };
        } else if (!(flags & RedirectFlags.DUPLICATE_OUT)) {
          this.fail('Redirection with no file');
        }
      }
    }
    return { flags, redirect };
  }

  parseAssign() {
    const tok = this.peek();
    if (tok.t !== 'Text') {
      return null;
    }
    const startIdx = this.current;
    this.expect('Text');
    const txt = this.text(tok);
    const eqIdx = txt.indexOf('=');
    if (
      eqIdx > 0 &&
      !this.isInterpolatedPosition(tok.start + eqIdx) &&
      isValidVarName(txt.slice(0, eqIdx))
    ) {
      const label = txt.slice(0, eqIdx);
      const txtValue = txt.slice(eqIdx + 1);
      const left = { type: 'simple', atom: { t: 'Text', text: txtValue } };
      if (this.delimits(this.peek())) {
        this.expectDelimit();
        return { label, value: left };
      }
      const right = this.parseAtom();
      if (!right) {
        this.fail('Expected an atom');
      }
      if (eqIdx === txt.length - 1) {
        return { label, value: right };
      }
      return { label, value: mergeAtoms(left, right) };
    }
    this.current = startIdx;
    return null;
  }

  // Returns true when the loop in parseAtom must stop after this token.
  atomSep(nextDelimits) {
    if (nextDelimits) {
      this.match('Delimit');
      return true;
    }
    return false;
  }

  parseAtom() {
    const atoms = [];
    let hasBraceOpen = false;
    let hasBraceClose = false;
    let hasComma = false;
    let hasGlobSyntax = false;
    for (;;) {
      const peeked = this.peek();
      if (peeked.t === 'Delimit') {
        this.expect('Delimit');
        break;
      }
      if (
        peeked.t === 'Eof' ||
        peeked.t === 'Semicolon' ||
        peeked.t === 'Newline' ||
        (this.insideSubshell !== null && this.closingTok() === peeked.t)
      ) {
        break;
      }
      const nextDelimits = this.delimits(this.peekN(1));
      let stop = false;
      switch (peeked.t) {
        case 'Asterisk':
        case 'DoubleAsterisk':
          hasGlobSyntax = true;
          this.expect(peeked.t);
          atoms.push({ t: peeked.t });
          stop = this.atomSep(nextDelimits);
          break;
        case 'BraceBegin':
        case 'BraceEnd':
        case 'Comma':
          if (peeked.t === 'BraceBegin') {
            hasBraceOpen = true;
          } else if (peeked.t === 'BraceEnd') {
            hasBraceClose = true;
          } else {
            hasComma = true;
          }
          this.expect(peeked.t);
          atoms.push({ t: peeked.t });
          stop = this.atomSep(nextDelimits);
          break;
        case 'CmdSubstBegin': {
          this.expect('CmdSubstBegin');
          const quoted = this.match('CmdSubstQuoted');
          const script = this.runSubparser('CmdSubst');
          atoms.push({ t: 'CmdSubst', script, quoted });
          stop = this.atomSep(this.delimits(this.peek()));
          break;
        }
        case 'SingleQuotedText':
        case 'DoubleQuotedText':
        case 'Text': {
          this.advance();
          let txt = this.text(peeked);
          if (peeked.t === 'Text' && txt.length && txt[0] === '~') {
            txt = txt.slice(1);
            atoms.push({ t: 'Tilde' });
            if (txt.length) {
              atoms.push({ t: 'Text', text: txt });
            }
          } else if (txt.length === 0 && peeked.t !== 'Text') {
            atoms.push({ t: 'QuotedEmpty' });
          } else {
            atoms.push({ t: 'Text', text: txt });
          }
          stop = this.atomSep(nextDelimits);
          break;
        }
        case 'Var':
          this.expect('Var');
          atoms.push({ t: 'Var', name: this.text(peeked) });
          stop = this.atomSep(nextDelimits);
          break;
        case 'VarArgv':
          this.expect('VarArgv');
          atoms.push({ t: 'VarArgv', n: peeked.n });
          stop = this.atomSep(nextDelimits);
          break;
        case 'OpenParen':
        case 'CloseParen':
          this.fail(
            `Unexpected token: \`${peeked.t === 'OpenParen' ? '(' : ')'}\``
          );
          break;
        default:
          return null;
      }
      if (stop) {
        break;
      }
    }
    if (atoms.length === 0) {
      return null;
    }
    if (atoms.length === 1) {
      return { type: 'simple', atom: atoms[0] };
    }
    return {
      type: 'compound',
      atoms,
      braceExpansionHint: hasBraceOpen && hasBraceClose && hasComma,
      globHint: hasGlobSyntax,
    };
  }

  text(tok) {
    return this.strpool.slice(tok.start, tok.end);
  }

  isInterpolatedPosition(pos) {
    return this.jsStringRanges.some(([s, e]) => pos >= s && pos < e);
  }

  ifClauseTokAt(tok) {
    if (this.isInterpolatedPosition(tok.start)) {
      return null;
    }
    const txt = this.text(tok);
    return IF_CLAUSE_TOKS.has(txt) ? txt : null;
  }

  ifClauseTokFromTok(tok) {
    if (tok.t === 'Text' && this.delimits(this.peekN(1))) {
      return this.ifClauseTokAt(tok);
    }
    return null;
  }

  advance() {
    if (!this.isAtEnd()) {
      this.current++;
    }
    return this.prev();
  }

  isAtEnd() {
    const t = this.peek().t;
    return (
      t === 'Eof' || (this.insideSubshell !== null && this.closingTok() === t)
    );
  }

  expect(tag) {
    if (this.check(tag)) {
      return this.advance();
    }
    throw new Error('Unexpected token');
  }

  expectAny(tags) {
    if (tags.includes(this.peek().t)) {
      return this.advance();
    }
    throw new Error('Unexpected token');
  }

  delimits(tok) {
    const t = tok.t;
    return (
      t === 'Delimit' ||
      t === 'Semicolon' ||
      t === 'Eof' ||
      t === 'Newline' ||
      (this.insideSubshell !== null && t === this.closingTok())
    );
  }

  expectDelimit() {
    if (this.delimits(this.peek())) {
      return this.advance();
    }
    throw new Error('Expected a delimiter token');
  }

  matchIfClauseTok(name) {
    const tok = this.peek();
    if (
      tok.t === 'Text' &&
      this.delimits(this.peekN(1)) &&
      this.ifClauseTokAt(tok) === name
    ) {
      this.advance();
      this.expectDelimit();
      return true;
    }
    return false;
  }

  match(tag) {
    if (this.peek().t === tag) {
      this.advance();
      return true;
    }
    return false;
  }

  matchAny(tags) {
    if (tags.includes(this.peek().t)) {
      this.advance();
      return true;
    }
    return false;
  }

  peekAnyIfClauseTok(names) {
    const tok = this.peek();
    if (tok.t !== 'Text' || !this.delimits(this.peekN(1))) {
      return false;
    }
    const name = this.ifClauseTokAt(tok);
    return name !== null && names.includes(name);
  }

  peekAny(tags) {
    return tags.includes(this.peek().t);
  }

  checkAny(tags) {
    return this.peekAny(tags);
  }

  check(tag) {
    return this.peek().t === tag;
  }

  peek() {
    return this.tokens[this.current];
  }

  peekN(n) {
    if (this.current + n >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1];
    }
    return this.tokens[this.current + n];
  }

  prev() {
    return this.tokens[this.current - 1];
  }

  combineErrors() {
    return this.errors.join('\n');
  }
}

/** Error thrown for scripts that fail to lex or parse (a plain Error in Bun). */
export class ShellSyntaxError extends Error {}

/**
 * Lex and parse a script assembled by template.mjs. Throws ShellSyntaxError
 * with Bun's exact (newline-joined) lexer or parser messages.
 */
export function parse(src, stringRefs = [], jsobjsLen = 0) {
  let lexResult;
  try {
    lexResult = lex(src, stringRefs, jsobjsLen);
  } catch (e) {
    if (e instanceof LexDepthError) {
      throw new ShellSyntaxError(
        'failed to lex/parse shell: Subshell nesting depth exceeded'
      );
    }
    throw e;
  }
  if (lexResult.errors.length) {
    throw new ShellSyntaxError(lexResult.errors.join('\n'));
  }
  const parser = new Parser(lexResult);
  try {
    return parser.parse();
  } catch (e) {
    if (e instanceof ParseFailure) {
      throw new ShellSyntaxError(parser.combineErrors());
    }
    throw e;
  }
}
