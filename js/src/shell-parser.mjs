/**
 * Enhanced shell command parser that handles &&, ||, ;, and () operators
 * This allows virtual commands to work properly with shell operators
 */

import { trace } from './$.utils.mjs';

/**
 * Token types for the parser
 */
const TokenType = {
  WORD: 'word',
  AND: '&&',
  OR: '||',
  SEMICOLON: ';',
  PIPE: '|',
  LPAREN: '(',
  RPAREN: ')',
  REDIRECT_OUT: '>',
  REDIRECT_APPEND: '>>',
  REDIRECT_IN: '<',
  EOF: 'eof',
};

/**
 * Parse a word token from the command string, handling quotes and escapes
 * @param {string} command - The command string
 * @param {number} startIndex - Starting position
 * @returns {{word: string, endIndex: number}} Parsed word and end position
 */
function parseWord(command, startIndex) {
  let word = '';
  let i = startIndex;
  let inQuote = false;
  let quoteChar = '';

  while (i < command.length) {
    const char = command[i];

    if (!inQuote) {
      const result = parseUnquotedChar(command, i, char, word);
      if (result.done) {
        return { word: result.word, endIndex: i };
      }
      word = result.word;
      i = result.index;
      if (result.startQuote) {
        inQuote = true;
        quoteChar = result.startQuote;
      }
    } else {
      const result = parseQuotedChar(command, i, char, word, quoteChar);
      word = result.word;
      i = result.index;
      if (result.endQuote) {
        inQuote = false;
        quoteChar = '';
      }
    }
  }

  return { word, endIndex: i };
}

/**
 * Parse a character when not inside quotes
 */
function parseUnquotedChar(command, i, char, word) {
  if (char === '"' || char === "'") {
    return { word: word + char, index: i + 1, startQuote: char };
  }
  if (/\s/.test(char) || '&|;()<>'.includes(char)) {
    return { word, done: true };
  }
  if (char === '\\' && i + 1 < command.length) {
    const escaped = command[i + 1];
    return { word: word + char + escaped, index: i + 2 };
  }
  return { word: word + char, index: i + 1 };
}

/**
 * Parse a character when inside quotes
 */
function parseQuotedChar(command, i, char, word, quoteChar) {
  if (char === quoteChar && command[i - 1] !== '\\') {
    return { word: word + char, index: i + 1, endQuote: true };
  }
  if (
    char === '\\' &&
    i + 1 < command.length &&
    (command[i + 1] === quoteChar || command[i + 1] === '\\')
  ) {
    const escaped = command[i + 1];
    return { word: word + char + escaped, index: i + 2 };
  }
  return { word: word + char, index: i + 1 };
}

/**
 * Try to match an operator at the current position
 * @returns {{type: string, value: string, length: number} | null}
 */
function matchOperator(command, i) {
  const twoChar = command.slice(i, i + 2);
  const oneChar = command[i];

  if (twoChar === '&&') {
    return { type: TokenType.AND, value: '&&', length: 2 };
  }
  if (twoChar === '||') {
    return { type: TokenType.OR, value: '||', length: 2 };
  }
  if (twoChar === '>>') {
    return { type: TokenType.REDIRECT_APPEND, value: '>>', length: 2 };
  }
  if (oneChar === '|') {
    return { type: TokenType.PIPE, value: '|', length: 1 };
  }
  if (oneChar === ';') {
    return { type: TokenType.SEMICOLON, value: ';', length: 1 };
  }
  if (oneChar === '(') {
    return { type: TokenType.LPAREN, value: '(', length: 1 };
  }
  if (oneChar === ')') {
    return { type: TokenType.RPAREN, value: ')', length: 1 };
  }
  if (oneChar === '>') {
    return { type: TokenType.REDIRECT_OUT, value: '>', length: 1 };
  }
  if (oneChar === '<') {
    return { type: TokenType.REDIRECT_IN, value: '<', length: 1 };
  }
  return null;
}

/**
 * Tokenize a shell command string
 */
function tokenize(command) {
  const tokens = [];
  let i = 0;

  while (i < command.length) {
    // Skip whitespace
    while (i < command.length && /\s/.test(command[i])) {
      i++;
    }

    if (i >= command.length) {
      break;
    }

    // A lone ampersand is a background-process operator, which this parser
    // intentionally leaves to the real shell. Guard here as well as in
    // needsRealShell() so malformed input can never leave the tokenizer at the
    // same index forever.
    if (
      command[i] === '&' &&
      command[i - 1] !== '&' &&
      command[i + 1] !== '&'
    ) {
      throw new Error('Background commands require a real shell');
    }

    // Check for operators
    const operator = matchOperator(command, i);
    if (operator) {
      tokens.push({ type: operator.type, value: operator.value });
      i += operator.length;
      continue;
    }

    // Parse word (respecting quotes)
    const { word, endIndex } = parseWord(command, i);
    i = endIndex;

    if (word) {
      tokens.push({ type: TokenType.WORD, value: word });
    }
  }

  tokens.push({ type: TokenType.EOF, value: '' });
  return tokens;
}

/**
 * Parse a sequence of commands with operators
 */
class ShellParser {
  constructor(command) {
    this.tokens = tokenize(command);
    this.pos = 0;
  }

  current() {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: '' };
  }

  peek() {
    return this.tokens[this.pos + 1] || { type: TokenType.EOF, value: '' };
  }

  consume() {
    const token = this.current();
    this.pos++;
    return token;
  }

  /**
   * Parse the main command sequence
   */
  parse() {
    return this.parseSequence();
  }

  /**
   * Parse a sequence of commands connected by &&, ||, ;
   */
  parseSequence() {
    const commands = [];
    const operators = [];

    // Parse first command
    let cmd = this.parsePipeline();
    if (cmd) {
      commands.push(cmd);
    }

    // Parse additional commands with operators
    while (
      this.current().type !== TokenType.EOF &&
      this.current().type !== TokenType.RPAREN
    ) {
      const op = this.current();

      if (
        op.type === TokenType.AND ||
        op.type === TokenType.OR ||
        op.type === TokenType.SEMICOLON
      ) {
        operators.push(op.type);
        this.consume();

        cmd = this.parsePipeline();
        if (cmd) {
          commands.push(cmd);
        }
      } else {
        break;
      }
    }

    if (commands.length === 1 && operators.length === 0) {
      return commands[0];
    }

    return {
      type: 'sequence',
      commands,
      operators,
    };
  }

  /**
   * Parse a pipeline (commands connected by |)
   */
  parsePipeline() {
    const commands = [];

    let cmd = this.parseCommand();
    if (cmd) {
      commands.push(cmd);
    }

    while (this.current().type === TokenType.PIPE) {
      this.consume();
      cmd = this.parseCommand();
      if (cmd) {
        commands.push(cmd);
      }
    }

    if (commands.length === 1) {
      return commands[0];
    }

    return {
      type: 'pipeline',
      commands,
    };
  }

  /**
   * Parse a single command or subshell
   */
  parseCommand() {
    // Check for subshell
    if (this.current().type === TokenType.LPAREN) {
      this.consume(); // consume (
      const subshell = this.parseSequence();

      if (this.current().type === TokenType.RPAREN) {
        this.consume(); // consume )
      }

      return {
        type: 'subshell',
        command: subshell,
      };
    }

    // Parse simple command
    return this.parseSimpleCommand();
  }

  /**
   * Parse a simple command (command + args + redirections)
   */
  parseSimpleCommand() {
    const words = [];
    const redirects = [];

    while (this.current().type !== TokenType.EOF) {
      const token = this.current();

      if (token.type === TokenType.WORD) {
        words.push(token.value);
        this.consume();
      } else if (
        token.type === TokenType.REDIRECT_OUT ||
        token.type === TokenType.REDIRECT_APPEND ||
        token.type === TokenType.REDIRECT_IN
      ) {
        this.consume();
        const target = this.current();
        if (target.type === TokenType.WORD) {
          redirects.push({
            type: token.type,
            target: target.value,
          });
          this.consume();
        }
      } else {
        break;
      }
    }

    if (words.length === 0) {
      return null;
    }

    const cmd = words[0];
    const args = words.slice(1).map((word) => {
      // Remove quotes if present
      if (
        (word.startsWith('"') && word.endsWith('"')) ||
        (word.startsWith("'") && word.endsWith("'"))
      ) {
        return {
          value: word.slice(1, -1),
          quoted: true,
          quoteChar: word[0],
        };
      }
      return {
        value: word,
        quoted: false,
      };
    });

    const result = {
      type: 'simple',
      cmd,
      args,
    };

    if (redirects.length > 0) {
      result.redirects = redirects;
    }

    return result;
  }
}

/**
 * Parse a shell command with support for &&, ||, ;, and ()
 */
export function parseShellCommand(command) {
  try {
    const parser = new ShellParser(command);
    const result = parser.parse();

    trace(
      'ShellParser',
      () =>
        `Parsed command | ${JSON.stringify(
          {
            input: command.slice(0, 100),
            result,
          },
          null,
          2
        )}`
    );

    return result;
  } catch (error) {
    trace(
      'ShellParser',
      () =>
        `Parse error | ${JSON.stringify(
          {
            command: command.slice(0, 100),
            error: error.message,
          },
          null,
          2
        )}`
    );

    // Return null to fallback to sh -c
    return null;
  }
}

function scanQuotedFeature(command, index, quote) {
  const char = command[index];

  if (quote === "'") {
    return {
      quote: char === quote ? null : quote,
      skip: 0,
      unsupported: false,
    };
  }
  if (char === '\\') {
    // Inside double quotes a backslash escapes $ ` " \ and newline. Our
    // lightweight tokenizer keeps words verbatim and never unescapes them, so
    // handing such a command to the built-in commands would leak the
    // backslashes into the arguments. Delegate to a real shell instead, which
    // applies exactly the POSIX rules.
    return {
      quote,
      skip: 1,
      unsupported: isDoubleQuoteEscape(command[index + 1]),
    };
  }
  if (char === quote) {
    return { quote: null, skip: 0, unsupported: false };
  }

  // Parameter and command substitution still occur in double quotes.
  return {
    quote,
    skip: 0,
    unsupported: char === '`' || char === '$',
  };
}

/**
 * Characters a backslash may escape inside double quotes, per POSIX: only
 * these keep the backslash meaningful - anything else stays literal.
 *
 * @param {string|undefined} char - The character following the backslash
 * @returns {boolean} true when the pair is a real double-quote escape
 */
function isDoubleQuoteEscape(char) {
  return (
    char === '$' ||
    char === '`' ||
    char === '"' ||
    char === '\\' ||
    char === '\n'
  );
}

/**
 * Detect backslash escapes that a real shell removes but our lightweight
 * tokenizer keeps verbatim.
 *
 * Two cases matter:
 *  - inside `"..."`, a backslash before $ ` " \\ or a newline;
 *  - outside quotes, any backslash escape - including the POSIX `'\\''` idiom
 *    used to embed an apostrophe in a single-quoted string.
 *
 * The built-in (virtual) command path would pass those backslashes on to the
 * command, so `echo "5 \\$US"` would print the backslash while a shell prints
 * `5 $US`. Commands like this are routed to the system shell instead, which is
 * the only way to get exactly the POSIX result - important now that
 * interpolating a value into a quoted position escapes it (issue #49).
 *
 * @param {string} command - The full command string
 * @returns {boolean} true when the command must be run by a real shell
 */
export function hasShellEscapes(command) {
  if (typeof command !== 'string' || !command.includes('\\')) {
    return false;
  }
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      // Inside '...' a backslash is an ordinary character.
      if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        if (isDoubleQuoteEscape(command[i + 1])) {
          return true;
        }
        i++;
        continue;
      }
      if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (char === '\\') {
      // Outside quotes a backslash escapes whatever follows it.
      if (i + 1 < command.length) {
        return true;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    }
  }
  return false;
}

function isSingleAmpersand(command, index) {
  return (
    command[index] === '&' &&
    command[index - 1] !== '&' &&
    command[index + 1] !== '&'
  );
}

function isUnsupportedUnquotedFeature(command, index) {
  const char = command[index];
  if ('`$~*?[<>'.includes(char) || isSingleAmpersand(command, index)) {
    return true;
  }

  return false;
}

/**
 * Check if a command needs shell features we don't handle.
 *
 * Redirection (`>`, `>>`, `<`, `2>`, `&>`, `<<`, ...) counts as such a
 * feature. The built-in (virtual) commands take a plain argument list, so a
 * redirection left in that list is passed through as a literal argument:
 * `echo hello > out.txt` would print `hello > out.txt` and write no file, and
 * `git push ... 2>&1` would report success while nothing was pushed. Sending
 * the whole command to the system shell is the only way to get exactly the
 * POSIX result (issue #46).
 *
 * @param {string} command - The full command string
 * @returns {boolean} true when the command must be run by a real shell
 */
export function needsRealShell(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      const scan = scanQuotedFeature(command, i, quote);
      if (scan.unsupported) {
        return true;
      }
      quote = scan.quote;
      i += scan.skip;
      continue;
    }

    if (char === '\\') {
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (isUnsupportedUnquotedFeature(command, i)) {
      return true;
    }
  }

  return false;
}

export default { parseShellCommand, needsRealShell, hasShellEscapes };
