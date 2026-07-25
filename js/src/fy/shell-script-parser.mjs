// Recursive-descent shell parser for the $fy translator.
//
// Produces a plain node tree (`{ term, text?, children }`) which
// `shell-formalizer.mjs` then materialises as a meta-language links network.
// Keeping the two steps apart means the grammar stays readable and the
// network construction stays mechanical.
//
// This parser is deliberately separate from `src/shell-parser.mjs`, which
// parses a *single* command line for the runtime. `$fy` needs whole-script
// structure: comments, blank lines, control flow and function definitions.

import { TokenType, tokenize } from './shell-lexer.mjs';

/** Reserved words that terminate a command list. */
const BLOCK_TERMINATORS = new Set([
  'then',
  'elif',
  'else',
  'fi',
  'do',
  'done',
  'esac',
  '}',
]);

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

const node = (term, children = [], text = undefined) => ({
  term,
  children,
  text,
});
const leaf = (term, text) => node(term, [], text);

class ShellParser {
  constructor(source) {
    this.tokens = tokenize(source);
    this.position = 0;
  }

  current() {
    return this.tokens[this.position];
  }

  at(type, text = undefined) {
    const token = this.current();
    return token.type === type && (text === undefined || token.text === text);
  }

  atWord(text) {
    return this.at(TokenType.WORD, text);
  }

  consume() {
    return this.tokens[this.position++];
  }

  expectWord(text) {
    if (this.atWord(text)) {
      this.consume();
      return true;
    }
    return false;
  }

  /** Skips newlines and `;` separators, emitting `blank` nodes for blank lines. */
  skipSeparators(collector) {
    let newlines = 0;
    for (;;) {
      if (this.at(TokenType.NEWLINE)) {
        this.consume();
        newlines += 1;
        // The first newline ends the previous statement; each further one is a
        // blank line worth preserving in the output.
        if (newlines > 1 && collector) {
          collector.push(node('blank'));
        }
        continue;
      }
      if (this.at(TokenType.OPERATOR, ';')) {
        this.consume();
        continue;
      }
      return;
    }
  }

  /** Whether the current token closes the enclosing block. */
  atBlockEnd(extraTerminators) {
    const token = this.current();
    if (token.type === TokenType.EOF) {
      return true;
    }
    if (
      token.type === TokenType.OPERATOR &&
      (token.text === ')' || token.text === ';;')
    ) {
      return true;
    }
    if (token.type !== TokenType.WORD) {
      return false;
    }
    return (
      BLOCK_TERMINATORS.has(token.text) || extraTerminators.has(token.text)
    );
  }

  parseScript() {
    return node('script', this.parseStatements(new Set()));
  }

  parseStatements(extraTerminators) {
    const statements = [];
    // Leading blank lines are not "blank lines between statements".
    this.skipSeparators(undefined);

    while (!this.atBlockEnd(extraTerminators)) {
      if (this.at(TokenType.COMMENT)) {
        statements.push(
          leaf('comment', this.consume().text.replace(/^#\s?/, ''))
        );
      } else {
        const statement = this.parseList();
        if (!statement) {
          break;
        }
        statements.push(statement);
      }
      this.skipSeparators(statements);
    }

    // Trailing blank lines add nothing to the translation.
    while (
      statements.length > 0 &&
      statements[statements.length - 1].term === 'blank'
    ) {
      statements.pop();
    }
    return statements;
  }

  /** `pipeline (&& | ||) pipeline ...`, left associative. */
  parseList() {
    let left = this.parsePipeline();
    if (!left) {
      return undefined;
    }
    while (
      this.at(TokenType.OPERATOR, '&&') ||
      this.at(TokenType.OPERATOR, '||')
    ) {
      const operator = this.consume().text === '&&' ? 'and' : 'or';
      // An operator may be followed by a newline before its right operand.
      while (this.at(TokenType.NEWLINE)) {
        this.consume();
      }
      const right = this.parsePipeline();
      if (!right) {
        break;
      }
      left = node(operator, [left, right]);
    }
    return left;
  }

  parsePipeline() {
    const stages = [];
    let stage = this.parseCommand();
    if (!stage) {
      return undefined;
    }
    stages.push(stage);
    while (this.at(TokenType.OPERATOR, '|')) {
      this.consume();
      while (this.at(TokenType.NEWLINE)) {
        this.consume();
      }
      stage = this.parseCommand();
      if (!stage) {
        break;
      }
      stages.push(stage);
    }
    return stages.length === 1 ? stages[0] : node('pipeline', stages);
  }

  parseCommand() {
    if (this.at(TokenType.OPERATOR, '(')) {
      this.consume();
      const body = this.parseStatements(new Set());
      if (this.at(TokenType.OPERATOR, ')')) {
        this.consume();
      }
      return node('subshell', [node('block', body)]);
    }
    if (this.atWord('{')) {
      this.consume();
      const body = this.parseStatements(new Set());
      this.expectWord('}');
      return node('block', body);
    }
    if (this.atWord('if')) {
      return this.parseIf();
    }
    if (this.atWord('while') || this.atWord('until')) {
      return this.parseLoop();
    }
    if (this.atWord('for')) {
      return this.parseFor();
    }
    if (this.atWord('case')) {
      return this.parseCase();
    }
    const functionNode = this.tryParseFunction();
    if (functionNode) {
      return functionNode;
    }
    return this.parseSimpleCommand();
  }

  /** `if list; then block [elif ...] [else block] fi` */
  parseIf() {
    this.consume(); // `if` / `elif`
    const condition = this.parseCondition('then');
    const consequent = node('block', this.parseStatements(new Set()));

    let alternative;
    if (this.atWord('elif')) {
      alternative = this.parseIf();
      return node('if', [condition, consequent, alternative]);
    }
    if (this.expectWord('else')) {
      alternative = node('block', this.parseStatements(new Set()));
    }
    this.expectWord('fi');
    return alternative
      ? node('if', [condition, consequent, alternative])
      : node('if', [condition, consequent]);
  }

  parseLoop() {
    const term = this.consume().text === 'while' ? 'while' : 'until';
    const condition = this.parseCondition('do');
    const body = node('block', this.parseStatements(new Set()));
    this.expectWord('done');
    return node(term, [condition, body]);
  }

  /** `for NAME in word...; do block done` */
  parseFor() {
    this.consume(); // `for`
    const variable = this.at(TokenType.WORD) ? this.consume().text : '_';
    const items = [];
    if (this.expectWord('in')) {
      while (
        this.at(TokenType.WORD) &&
        !BLOCK_TERMINATORS.has(this.current().text)
      ) {
        items.push(leaf('word', this.consume().text));
      }
    }
    this.skipSeparators(undefined);
    this.expectWord('do');
    const body = node('block', this.parseStatements(new Set()));
    this.expectWord('done');
    return node('for', [
      leaf('name', variable),
      node('word-list', items),
      body,
    ]);
  }

  /** `case word in pattern) block ;; ... esac` */
  parseCase() {
    this.consume(); // `case`
    const subject = this.at(TokenType.WORD)
      ? leaf('word', this.consume().text)
      : leaf('word', '');
    this.expectWord('in');
    this.skipSeparators(undefined);

    const branches = [];
    while (!this.atWord('esac') && !this.at(TokenType.EOF)) {
      // A pattern list is `a|b|c)`. The lexer already split on `|` and `)`.
      const patterns = [];
      while (this.at(TokenType.WORD)) {
        // `*` is the shell's catch-all pattern, i.e. `default:`.
        const pattern = this.consume().text;
        patterns.push(
          leaf(pattern === '*' ? 'pattern-default' : 'pattern', pattern)
        );
        if (this.at(TokenType.OPERATOR, '|')) {
          this.consume();
          continue;
        }
        break;
      }
      if (this.at(TokenType.OPERATOR, ')')) {
        this.consume();
      }
      const body = node('block', this.parseStatements(new Set()));
      if (this.at(TokenType.OPERATOR, ';;')) {
        this.consume();
      }
      this.skipSeparators(undefined);
      branches.push(
        node('case-branch', [node('pattern-list', patterns), body])
      );
    }
    this.expectWord('esac');
    return node('case', [subject, node('case-branch-list', branches)]);
  }

  /** Consumes `function name [()]`, or `undefined` when that is not next. */
  parseKeywordFunctionName() {
    this.consume();
    if (!this.at(TokenType.WORD)) {
      return undefined;
    }
    const name = this.consume().text;
    if (this.at(TokenType.OPERATOR, '(')) {
      this.consume();
      if (this.at(TokenType.OPERATOR, ')')) {
        this.consume();
      }
    }
    return name;
  }

  /** Consumes `name ()`, or `undefined` when that is not next. */
  parseBareFunctionName() {
    const isOperator = (offset, text) =>
      this.tokens[this.position + offset]?.type === TokenType.OPERATOR &&
      this.tokens[this.position + offset]?.text === text;

    if (
      !this.at(TokenType.WORD) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.current().text) ||
      !isOperator(1, '(') ||
      !isOperator(2, ')')
    ) {
      return undefined;
    }
    const name = this.consume().text;
    this.consume();
    this.consume();
    return name;
  }

  /** `name() { ... }` or `function name { ... }` */
  tryParseFunction() {
    const start = this.position;
    const name = this.atWord('function')
      ? this.parseKeywordFunctionName()
      : this.parseBareFunctionName();

    if (name === undefined) {
      this.position = start;
      return undefined;
    }

    this.skipSeparators(undefined);
    if (!this.expectWord('{')) {
      this.position = start;
      return undefined;
    }
    const body = node('block', this.parseStatements(new Set()));
    this.expectWord('}');
    return node('function', [leaf('name', name), body]);
  }

  /**
   * Parses the condition of `if`/`while`/`until` up to its introducer keyword
   * (`then`/`do`), which the caller has named.
   */
  parseCondition(introducer) {
    const condition = this.parseStatements(new Set([introducer]));
    this.skipSeparators(undefined);
    this.expectWord(introducer);
    if (condition.length === 1) {
      return condition[0];
    }
    return node('block', condition);
  }

  /**
   * True once the current token can no longer belong to a simple command.
   *
   * @param {object[]} words Words read so far; an empty list means the parser
   *   is still in command position.
   */
  atCommandEnd(words) {
    // Reserved words are only reserved in command position: `echo done` runs
    // `echo` with the argument `done`, it does not close a loop. Assignment
    // prefixes do not consume the command position, so the check stays on
    // `words`.
    if (words.length === 0 && this.atBlockEnd(new Set())) {
      return true;
    }
    return (
      this.at(TokenType.EOF) ||
      this.at(TokenType.NEWLINE) ||
      this.at(TokenType.COMMENT) ||
      this.at(TokenType.OPERATOR)
    );
  }

  /** Reads the assignment prefixes, words and redirects of one command. */
  parseCommandParts() {
    const assignments = [];
    const words = [];
    const redirects = [];

    while (!this.atCommandEnd(words)) {
      if (this.at(TokenType.REDIRECT)) {
        const operator = this.consume().text;
        const target = this.at(TokenType.WORD) ? this.consume().text : '';
        redirects.push(node('redirect', [leaf('word', target)], operator));
        continue;
      }

      const token = this.consume();
      const assignment =
        words.length === 0 ? ASSIGNMENT.exec(token.text) : undefined;
      if (assignment) {
        assignments.push(
          node('assignment', [leaf('word', assignment[2])], assignment[1])
        );
        continue;
      }
      words.push(leaf('word', token.text));
    }

    return { assignments, words, redirects };
  }

  parseSimpleCommand() {
    const { assignments, words, redirects } = this.parseCommandParts();

    if (words.length === 0) {
      if (assignments.length === 0) {
        return undefined;
      }
      // Bare `NAME=value` statements are variable declarations.
      return assignments.length === 1
        ? assignments[0]
        : node('block', assignments);
    }

    const name = words[0].text;
    const rest = words.slice(1);

    if (name === 'export' || name === 'local' || name === 'readonly') {
      return this.buildDeclaration(name, rest);
    }
    if (name === 'set' && rest.length > 0) {
      return node('set-option', rest);
    }
    if (name === 'exit') {
      return node('exit', rest);
    }
    if (name === 'return') {
      return node('return', rest);
    }
    if (name === 'source' || name === '.') {
      return node('source', rest);
    }

    const children = [
      node('word-list', words),
      node('redirect-list', redirects),
    ];
    if (assignments.length > 0) {
      // Prefixed assignments (`FOO=bar cmd`) scope an environment variable to
      // one command; keep them attached so a rule can render them.
      return node('command', [
        ...children,
        node('assignment-list', assignments),
      ]);
    }
    return node('command', children);
  }

  buildDeclaration(keyword, words) {
    const declarations = words.map((word) => {
      const assignment = ASSIGNMENT.exec(word.text);
      return assignment
        ? node('assignment', [leaf('word', assignment[2])], assignment[1])
        : node('assignment', [leaf('word', '')], word.text);
    });
    const term = keyword === 'export' ? 'export' : 'local';
    return declarations.length === 1
      ? node(term, declarations[0].children, declarations[0].text)
      : node(
          'block',
          declarations.map((entry) => node(term, entry.children, entry.text))
        );
  }
}

/**
 * Parses a shell script into a plain node tree.
 *
 * @param {string} source Shell source text.
 * @returns {{term: string, children: object[], text?: string}} The `script` root node.
 */
export function parseShellScript(source) {
  return new ShellParser(source).parseScript();
}
