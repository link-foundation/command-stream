// zx-compatible verbose logger and command highlighter (issue #26).

import { inspect } from 'node:util';
import process from 'node:process';
import { chalk } from './vendor-core.mjs';

const formatters = {
  cmd: ({ cmd }) => formatCmd(cmd),
  stdout: ({ data }) => data,
  stderr: ({ data }) => data,
  custom: ({ data }) => data,
  fetch(entry) {
    const init = entry.init ? ` ${inspect(entry.init)}` : '';
    return `$ ${chalk.greenBright('fetch')} ${entry.url}${init}\n`;
  },
  cd: (entry) => `$ ${chalk.greenBright('cd')} ${entry.dir}\n`,
  retry(entry) {
    const total = entry.total === Infinity ? '' : `/${entry.total}`;
    const delay = entry.delay > 0 ? `; next in ${entry.delay}ms` : '';
    return `${chalk.bgRed.white(' FAIL ')} Attempt: ${entry.attempt}${total}${delay}\n`;
  },
  end: () => '',
  kill: () => '',
};

/**
 * Write a log entry to `log.output` (stderr by default) when it is verbose.
 * Custom renderers can be registered per kind via `log.formatters`.
 *
 * @param {object} entry Log entry with a `kind` discriminator.
 */
export function log(entry) {
  if (!entry.verbose) {
    return;
  }
  const stream = log.output || process.stderr;
  const format = log.formatters?.[entry.kind] || formatters[entry.kind];
  if (!format) {
    return;
  }
  stream.write(format(entry));
}

const SPACE_RE = /\s/;
const SYNTAX = '()[]{}<>;:+|&=';
const CMD_BREAK = '|&;><';
const RESERVED_WORDS = new Set(
  'if then else elif fi case esac for select while until do done in EOF'.split(
    ' '
  )
);

// Accumulates words of a shell command and paints them: the command name is
// green, operators red, quoted strings yellow and shell keywords cyan.
class CmdHighlighter {
  out = '$ ';
  buf = '';
  mode = '';
  quote = '';
  pos = 0;

  paint(word) {
    this.pos++;
    if (this.mode === 'syntax') {
      if (CMD_BREAK.includes(word)) {
        this.pos = 0;
      }
      return chalk.red(this.buf);
    }
    if (this.mode === 'quote' || this.mode === 'dollar') {
      return chalk.yellowBright(this.buf);
    }
    if (RESERVED_WORDS.has(word)) {
      return chalk.cyanBright(this.buf);
    }
    if (this.pos === 1) {
      this.pos = Infinity;
      return chalk.greenBright(this.buf);
    }
    return this.buf;
  }

  flush() {
    const word = this.buf.trim();
    this.out += word ? this.paint(word) : this.buf;
    this.mode = '';
    this.buf = '';
  }

  push(c) {
    if (this.quote) {
      this.buf += c;
      if (c === this.quote) {
        this.flush();
        this.quote = '';
      }
    } else if (c === '$') {
      this.flushAs('dollar', c);
    } else if (c === "'" || c === '"') {
      this.flush();
      this.mode = 'quote';
      this.quote = c;
      this.buf += c;
    } else if (SPACE_RE.test(c)) {
      this.flush();
      this.buf += c;
    } else if (SYNTAX.includes(c)) {
      this.pushSyntax(c);
    } else {
      this.buf += c;
    }
  }

  flushAs(mode, c) {
    this.flush();
    this.mode = mode;
    this.buf += c;
    this.flush();
  }

  pushSyntax(c) {
    // `FOO=bar cmd`: the assignment must not steal the command-name color.
    const isEnv = c === '=' && this.pos === 0;
    if (isEnv) {
      this.pos = 1;
    }
    this.flushAs('syntax', c);
    if (isEnv) {
      this.pos = -1;
    }
  }
}

/**
 * Render a command the way zx prints it in verbose mode.
 *
 * @param {string} cmd Shell command.
 * @returns {string} Colored command line terminated by a newline.
 */
export function formatCmd(cmd) {
  if (cmd === undefined || cmd === null) {
    return chalk.grey('undefined');
  }
  const highlighter = new CmdHighlighter();
  for (const c of cmd) {
    highlighter.push(c);
  }
  highlighter.flush();
  return `${highlighter.out.replace(/\n/g, chalk.reset('\n> '))}\n`;
}
