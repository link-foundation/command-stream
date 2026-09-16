/**
 * Enhanced shell command parser that handles &&, ||, ;, and () operators
 * This allows virtual commands to work properly with shell operators
 */

import { trace } from './$.utils.mjs';

/**
 * Scans one shell word starting at `start`.
 *
 * A word ends at whitespace or at one of `breakChars`, but only outside quotes:
 * `'a|b'` is a single word. Single quotes are literal, double quotes understand
 * the `\"` `\\` `\$` `` \` `` escapes, and outside quotes a backslash escapes the
 * next character. Adjacent pieces concatenate, so `'it'\''s` is the one word
 * `it's` - exactly the way a POSIX shell reads it.
 *
 * Both forms of the word are returned: `raw` is the text as written, which is
 * what a command line rebuilt for a real shell needs, and `value` is what the
 * command itself should receive.
 */
export function scanWord(command, start, breakChars) {
  let raw = '';
  let value = '';
  let quoted = false;
  let quoteChar = '';
  let i = start;

  while (i < command.length) {
    const char = command[i];

    if (char === "'" || char === '"') {
      quoted = true;
      if (!quoteChar) quoteChar = char;
      raw += char;
      i++;
      while (i < command.length && command[i] !== char) {
        // Only double quotes have escapes; inside single quotes everything is literal.
        if (char === '"' && command[i] === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) {
          raw += command[i] + command[i + 1];
          value += command[i + 1];
          i += 2;
          continue;
        }
        raw += command[i];
        value += command[i];
        i++;
      }
      if (i < command.length) {
        raw += command[i];
        i++;
      }
      continue;
    }

    if (char === '\\' && i + 1 < command.length) {
      raw += char + command[i + 1];
      value += command[i + 1];
      i += 2;
      continue;
    }

    if (/\s/.test(char) || breakChars.includes(char)) break;

    raw += char;
    value += char;
    i++;
  }

  return { raw, value, quoted, quoteChar, end: i };
}

/**
 * Renders a parsed argument back into a command line for a real shell. The raw
 * text is used whenever it is known, so quoting and expansions survive the round
 * trip exactly as they were written.
 */
export function formatArgForShell(arg) {
  if (arg === null || arg === undefined) return '';
  if (typeof arg === 'string') {
    return arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'") ? `"${arg}"` : arg;
  }
  if (arg.raw !== undefined) return arg.raw;
  if (arg.quoted && arg.quoteChar) return `${arg.quoteChar}${arg.value}${arg.quoteChar}`;
  if (arg.value === undefined) return String(arg);
  return arg.value.includes(' ') ? `"${arg.value}"` : arg.value;
}

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
  EOF: 'eof'
};

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
    
    if (i >= command.length) break;
    
    // Check for operators
    if (command[i] === '&' && command[i + 1] === '&') {
      tokens.push({ type: TokenType.AND, value: '&&' });
      i += 2;
    } else if (command[i] === '|' && command[i + 1] === '|') {
      tokens.push({ type: TokenType.OR, value: '||' });
      i += 2;
    } else if (command[i] === '|') {
      tokens.push({ type: TokenType.PIPE, value: '|' });
      i++;
    } else if (command[i] === ';') {
      tokens.push({ type: TokenType.SEMICOLON, value: ';' });
      i++;
    } else if (command[i] === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(' });
      i++;
    } else if (command[i] === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')' });
      i++;
    } else if (command[i] === '>' && command[i + 1] === '>') {
      tokens.push({ type: TokenType.REDIRECT_APPEND, value: '>>' });
      i += 2;
    } else if (command[i] === '>') {
      tokens.push({ type: TokenType.REDIRECT_OUT, value: '>' });
      i++;
    } else if (command[i] === '<') {
      tokens.push({ type: TokenType.REDIRECT_IN, value: '<' });
      i++;
    } else {
      // Parse word (respecting quotes)
      const word = scanWord(command, i, '&|;()<>');
      if (word.end === i) {
        // A lone `&` reaches this branch without matching any operator. Consume
        // it rather than looping forever on the same character.
        i++;
        continue;
      }
      i = word.end;

      if (word.raw) {
        tokens.push({
          type: TokenType.WORD,
          value: word.raw,
          unquoted: word.value,
          quoted: word.quoted,
          quoteChar: word.quoteChar
        });
      }
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
    while (this.current().type !== TokenType.EOF && 
           this.current().type !== TokenType.RPAREN) {
      const op = this.current();
      
      if (op.type === TokenType.AND || 
          op.type === TokenType.OR || 
          op.type === TokenType.SEMICOLON) {
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
      operators
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
      commands
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
        command: subshell
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
        words.push(token);
        this.consume();
      } else if (token.type === TokenType.REDIRECT_OUT || 
                 token.type === TokenType.REDIRECT_APPEND ||
                 token.type === TokenType.REDIRECT_IN) {
        this.consume();
        const target = this.current();
        if (target.type === TokenType.WORD) {
          redirects.push({
            type: token.type,
            target: target.unquoted
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
    
    // The tokenizer already did the unquoting, and kept the raw text so a
    // command line can be rebuilt for a real shell without losing anything.
    const cmd = words[0].unquoted;
    const args = words.slice(1).map(word => ({
      value: word.unquoted,
      raw: word.value,
      quoted: word.quoted,
      quoteChar: word.quoteChar
    }));
    
    const result = {
      type: 'simple',
      cmd,
      args
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
    
    trace('ShellParser', () => `Parsed command | ${JSON.stringify({
      input: command.slice(0, 100),
      result
    }, null, 2)}`);
    
    return result;
  } catch (error) {
    trace('ShellParser', () => `Parse error | ${JSON.stringify({
      command: command.slice(0, 100),
      error: error.message
    }, null, 2)}`);
    
    // Return null to fallback to sh -c
    return null;
  }
}

/**
 * Check if a command needs shell features we don't handle
 */
export function needsRealShell(command) {
  // Check for features we don't handle yet
  const unsupported = [
    '`',     // Command substitution
    '$(',    // Command substitution
    '${',    // Variable expansion
    '~',     // Home expansion (at start of word)
    '*',     // Glob patterns
    '?',     // Glob patterns
    '[',     // Glob patterns
    '2>',    // stderr redirection
    '&>',    // Combined redirection
    '>&',    // File descriptor duplication
    '<<',    // Here documents
    '<<<',   // Here strings
  ];
  
  for (const feature of unsupported) {
    if (command.includes(feature)) {
      return true;
    }
  }
  
  return false;
}

export default { parseShellCommand, needsRealShell, scanWord, formatArgForShell };