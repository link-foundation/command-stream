// The Bun Shell interpreter, ported from Bun's interpreter.rs and its state
// machines (src/runtime/shell/states/: Script, Stmt, Binary, Pipeline,
// Subshell, If, CondExpr, Assigns, Cmd). Each state becomes an async method
// that resolves to the node's exit code.
//
// IO (Bun's `IO`): {stdin, stdout, stderr} with the kinds documented in
// io.mjs. JS values interpolated into the template are addressed by index
// (`jsobjs`); errors Bun throws into JS (invalid JS redirect targets) reject
// the run, everything else is reported on stderr with an exit code.

import fs from './fs.mjs';
import path from 'node:path';
import { inspect } from 'node:util';
import {
  Builtin,
  SMALL_BUILTINS,
  builtinInFromCmdIn,
  builtinKind,
  builtinOutFromCmdOut,
  openRedirectFile,
  which,
} from './builtin.mjs';
import { EnvKind, ShellExecEnv, envMapFromObject } from './env.mjs';
import { expandAtom, expansionWords } from './expansion.mjs';
import { filePathOf } from './file.mjs';
import {
  Channel,
  ChannelTarget,
  FdTarget,
  PIPE_OUT,
  Reader,
  ShellSysError,
  StreamTarget,
  Writer,
  fdOut,
} from './io.mjs';
import { RedirectFlags } from './lexer.mjs';
import { runSubprocess } from './subprocess.mjs';

const IS_WINDOWS = process.platform === 'win32';

// The larger builtins live in their own modules and are loaded on first use.
const BUILTIN_MODULES = {
  ls: './builtins/ls.mjs',
  mkdir: './builtins/mkdir.mjs',
  touch: './builtins/touch.mjs',
  rm: './builtins/rm.mjs',
  mv: './builtins/mv.mjs',
  cat: './builtins/cat.mjs',
  cp: './builtins/cp.mjs',
};

async function builtinImpl(kind) {
  if (SMALL_BUILTINS[kind]) {
    return SMALL_BUILTINS[kind];
  }
  const mod = await import(BUILTIN_MODULES[kind]);
  return mod[kind];
}

/** An error Bun throws into JS (the run rejects with it). */
export class ShellJsError extends TypeError {}

function isArrayBufferLike(v) {
  return (
    ArrayBuffer.isView(v) ||
    v instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer === 'function' && v instanceof SharedArrayBuffer)
  );
}

function byteView(v) {
  return ArrayBuffer.isView(v)
    ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    : new Uint8Array(v);
}

function isBodyValue(v) {
  return (
    (typeof Response === 'function' && v instanceof Response) ||
    (typeof Request === 'function' && v instanceof Request)
  );
}

async function bodyBytes(v) {
  if (v.bodyUsed) {
    return Buffer.alloc(0);
  }
  return Buffer.from(await v.arrayBuffer());
}

function unknownJsValue(v) {
  return new ShellJsError(`Unknown JS value used in shell: ${inspect(v)}`);
}

function isDeclarationUtility(atom) {
  return atom?.type === 'simple' && atom.atom.t === 'Text'
    ? atom.atom.text === 'export'
    : false;
}

function isAssignmentWord(atom) {
  const first = atom.type === 'simple' ? atom.atom : atom.atoms[0];
  if (first?.t !== 'Text') {
    return false;
  }
  const eq = first.text.indexOf('=');
  return eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(first.text.slice(0, eq));
}

function envObject(shell) {
  const env = {};
  for (const [k, v] of shell.exportEnv.entries()) {
    env[k] = v;
  }
  for (const [k, v] of shell.cmdLocalEnv.entries()) {
    const existing = Object.keys(env).find(
      (key) => IS_WINDOWS && key.toUpperCase() === k.toUpperCase()
    );
    env[existing ?? k] = v;
  }
  return env;
}

export class Interpreter {
  /**
   * @param {object} opts
   * @param {unknown[]} opts.jsobjs JS values referenced by the script
   * @param {Record<string, string>} opts.env the export environment
   * @param {string} [opts.cwd] initial directory (default: process.cwd())
   * @param {boolean} [opts.quiet] buffer stdout/stderr instead of echoing
   * @param {string[]} [opts.argv] positional parameters ($0..$9)
   */
  constructor({ jsobjs = [], env, cwd, quiet = false, argv = process.argv }) {
    this.jsobjs = jsobjs;
    this.argv = argv;
    this.root = new ShellExecEnv({
      exportEnv: envMapFromObject(env ?? process.env),
      cwd: process.cwd(),
    });
    if (cwd !== undefined && cwd !== null) {
      this.root.changeCwd(cwd, true);
    }
    const out = (stream, captured) =>
      quiet ? PIPE_OUT : fdOut(new Writer(new StreamTarget(stream)), captured);
    this.rootIO = {
      stdin: { kind: 'fd', reader: new Reader({ type: 'stdin' }) },
      stdout: out(process.stdout, this.root.bufferedStdout),
      stderr: out(process.stderr, this.root.bufferedStderr),
    };
    this.runCmdSubst = (script, shell) => this.cmdSubst(script, shell);
  }

  /** Run a parsed script: resolves to {exitCode, stdout, stderr} buffers. */
  async run(script) {
    const exitCode = await this.script(script, this.root, this.rootIO);
    return {
      exitCode,
      stdout: this.root.bufferedStdout.toBuffer(),
      stderr: this.root.bufferedStderr.toBuffer(),
    };
  }

  // --- control flow ------------------------------------------------------

  async script(node, shell, io) {
    let exitCode = 0;
    for (const stmt of node.stmts) {
      exitCode = await this.stmt(stmt, shell, io);
    }
    return exitCode;
  }

  async stmt(stmt, shell, io) {
    let exitCode = 0;
    for (const expr of stmt.exprs) {
      exitCode = await this.expr(expr, shell, io);
    }
    return exitCode;
  }

  async stmts(stmts, shell, io) {
    let exitCode = 0;
    for (const stmt of stmts) {
      exitCode = await this.stmt(stmt, shell, io);
    }
    return exitCode;
  }

  expr(node, shell, io) {
    switch (node.type) {
      case 'assign':
        return this.assigns(node.assigns, shell, 'assign');
      case 'binary':
        return this.binary(node, shell, io);
      case 'pipeline':
        return this.pipeline(node, shell, io);
      case 'cmd':
        return this.cmd(node, shell, io);
      case 'subshell':
        return this.subshell(node, shell, io);
      case 'if':
        return this.ifClause(node, shell, io);
      case 'condexpr':
        return this.condExpr(node, shell, io);
      default:
        throw new Error(`unknown shell node: ${node.type}`);
    }
  }

  async binary(node, shell, io) {
    const left = await this.expr(node.left, shell, io);
    if ((node.op === 'and' && left !== 0) || (node.op === 'or' && left === 0)) {
      return left;
    }
    return this.expr(node.right, shell, io);
  }

  async pipeline(node, shell, io) {
    const items = node.items.filter((item) => item.type !== 'assign');
    if (items.length === 0) {
      return 0;
    }
    const n = items.length;
    const channels = Array.from({ length: n - 1 }, () => new Channel());
    const runs = items.map(async (item, i) => {
      const stdin =
        i === 0
          ? io.stdin
          : {
              kind: 'fd',
              reader: new Reader({ type: 'channel', channel: channels[i - 1] }),
            };
      const stdout =
        i === n - 1
          ? io.stdout
          : fdOut(new Writer(new ChannelTarget(channels[i])), null);
      const itemIO = { stdin, stdout, stderr: io.stderr };
      const env = shell.dupeForSubshell(itemIO, EnvKind.PIPELINE);
      try {
        return await this.expr(item, env, itemIO);
      } finally {
        if (i > 0) {
          stdin.reader.deref();
        }
        if (i < n - 1) {
          await stdout.writer.deref();
        }
      }
    });
    const codes = await Promise.all(runs);
    return n >= 2 ? codes[n - 1] : 0;
  }

  subshell(node, shell, io) {
    const env = shell.dupeForSubshell(io, EnvKind.SUBSHELL);
    return this.script(node.script, env, io);
  }

  async ifClause(node, shell, io) {
    const cond = await this.stmts(node.cond, shell, io);
    if (cond === 0) {
      return this.stmts(node.then, shell, io);
    }
    const parts = node.elseParts;
    if (parts.length === 0) {
      return 0;
    }
    if (parts.length === 1) {
      return this.stmts(parts[0], shell, io);
    }
    let i = 0;
    for (; i + 1 < parts.length; i += 2) {
      if ((await this.stmts(parts[i], shell, io)) === 0) {
        return this.stmts(parts[i + 1], shell, io);
      }
    }
    return i < parts.length ? this.stmts(parts[i], shell, io) : 0;
  }

  async condExpr(node, shell, io) {
    const args = [];
    for (const atom of node.args) {
      try {
        const out = await this.expand(atom, shell);
        args.push(out.buf);
      } catch (e) {
        return this.writeFailingErrorNoThrow(io, shell, `${displayErr(e)}\n`);
      }
    }
    const first = args[0] ?? '';
    switch (node.op) {
      case '-f':
      case '-d':
      case '-c': {
        if (first === '') {
          return 1;
        }
        if (IS_WINDOWS && first === '/dev/null') {
          // Bun maps /dev/null to the NUL character device.
          return node.op === '-c' ? 0 : 1;
        }
        let st;
        try {
          st = await fs.promises.stat(path.resolve(shell.cwd, first));
        } catch {
          return 1;
        }
        const ok = {
          '-f': () => st.isFile(),
          '-d': () => st.isDirectory(),
          '-c': () => st.isCharacterDevice(),
        }[node.op]();
        return ok ? 0 : 1;
      }
      case '-z':
        return first === '' ? 0 : 1;
      case '-n':
        return first !== '' ? 0 : 1;
      case '==':
        return args.length === 0 || (args.length >= 2 && args[0] === args[1])
          ? 0
          : 1;
      case '!=':
        return args.length >= 2 && args[0] !== args[1] ? 0 : 1;
      default:
        return 1;
    }
  }

  // --- expansion ----------------------------------------------------------

  expand(atom, shell, { isAssign = false, assignCtx = false } = {}) {
    return expandAtom(atom, {
      shell,
      runCmdSubst: this.runCmdSubst,
      argv: this.argv,
      isAssign,
      assignCtx,
    });
  }

  /** `$(...)`: run in a child env whose stdout is buffered. */
  async cmdSubst(script, shell) {
    const io = {
      stdin: this.rootIO.stdin,
      stdout: PIPE_OUT,
      stderr: this.rootIO.stderr,
    };
    const env = shell.dupeForSubshell(io, EnvKind.CMD_SUBST);
    const exitCode = await this.script(script, env, io);
    return { exitCode, stdout: env.bufferedStdout.toString() };
  }

  /** Assignments (Bun's `Assigns` state): 0, or 1 on an expansion error. */
  async assigns(assigns, shell, ctx) {
    for (const { label, value } of assigns) {
      let out;
      try {
        out = await this.expand(value, shell, {
          isAssign: true,
          assignCtx: true,
        });
      } catch (e) {
        // Bun reports nothing here: the assignment just fails with 1.
        displayErr(e);
        return 1;
      }
      shell.assignVar(label, expansionWords(out).join(' '), ctx);
    }
    return 0;
  }

  // --- errors -----------------------------------------------------------

  /** Bun's `Cmd` write_failing_error: a failed write rejects the run. */
  async cmdWriteFailingError(io, shell, msg) {
    const err = await this.writeErr(io, shell, msg);
    if (err) {
      throw err;
    }
    return 1;
  }

  /** CondExpr/Assigns flavour: a failed write becomes the exit code. */
  async writeFailingErrorNoThrow(io, shell, msg) {
    const err = await this.writeErr(io, shell, msg);
    return err ? err.errno : 1;
  }

  writeErr(io, shell, msg) {
    if (io.stderr.kind === 'fd') {
      return io.stderr.writer.write(msg, io.stderr.captured);
    }
    if (io.stderr.kind === 'pipe') {
      shell.bufferedStderr.append(Buffer.from(msg));
    }
    return Promise.resolve(null);
  }

  // --- commands ---------------------------------------------------------

  async cmd(node, shell, io) {
    if (node.assigns.length > 0) {
      const code = await this.assigns(node.assigns, shell, 'cmd');
      if (code !== 0) {
        return code;
      }
    }

    let redirectFile = null;
    if (node.redirectFile?.type === 'atom') {
      let out;
      try {
        out = await this.expand(node.redirectFile.atom, shell);
      } catch (e) {
        return this.cmdWriteFailingError(io, shell, `${displayErr(e)}\n`);
      }
      redirectFile = out.bounds.length === 0 ? out.buf : '';
    }

    const args = [];
    let exitCode = null;
    const declaration = isDeclarationUtility(node.nameAndArgs[0]);
    for (let idx = 0; idx < node.nameAndArgs.length; idx++) {
      const atom = node.nameAndArgs[idx];
      let out;
      try {
        out = await this.expand(atom, shell, {
          assignCtx: idx > 0 && declaration && isAssignmentWord(atom),
        });
      } catch (e) {
        return this.cmdWriteFailingError(io, shell, `${displayErr(e)}\n`);
      }
      if (
        node.nameAndArgs.length === 1 &&
        atom.type === 'simple' &&
        atom.atom.t === 'CmdSubst'
      ) {
        exitCode = out.outExitCode;
      }
      if (out.bounds.length > 0) {
        args.push(...expansionWords(out));
      } else if (out.buf.length > 0 || out.hasQuotedEmpty) {
        args.push(out.buf);
      }
    }

    if (args.length === 0 || args[0] === '') {
      return exitCode ?? 0;
    }
    const kind = builtinKind(args[0]);
    if (kind !== null) {
      return this.runBuiltin(kind, args, node, redirectFile, shell, io);
    }
    return this.runExternal(args, node, redirectFile, shell, io);
  }

  jsobj(idx) {
    if (idx >= this.jsobjs.length) {
      throw new ShellJsError('Invalid JS object reference in shell');
    }
    return this.jsobjs[idx];
  }

  async runBuiltin(kind, args, node, redirectFile, shell, io) {
    const b = new Builtin({
      kind,
      args: args.slice(1),
      shell,
      stdin: builtinInFromCmdIn(io.stdin),
      stdout: builtinOutFromCmdOut(io.stdout, 'stdout'),
      stderr: builtinOutFromCmdOut(io.stderr, 'stderr'),
    });
    const flags = node.redirect;
    let redirectWriter = null;
    let redirectReader = null;
    if (node.redirectFile?.type === 'atom') {
      if (redirectFile === '') {
        return this.cmdWriteFailingError(
          io,
          shell,
          `bun: ambiguous redirect: at \`${kind}\`\n`
        );
      }
      let fd;
      try {
        fd = openRedirectFile(shell.cwd, redirectFile, flags);
      } catch (e) {
        return this.cmdWriteFailingError(
          io,
          shell,
          `bun: ${e.message}: ${redirectFile}`
        );
      }
      if (flags & RedirectFlags.STDIN) {
        redirectReader = new Reader({ type: 'fd', fd, owned: true });
        b.stdin = { kind: 'fd', reader: redirectReader };
      }
      if (flags & (RedirectFlags.STDOUT | RedirectFlags.STDERR)) {
        redirectWriter = new Writer(
          new FdTarget(fd, { owned: !redirectReader })
        );
        if (flags & RedirectFlags.STDOUT) {
          b.stdout = { kind: 'fd', writer: redirectWriter, captured: null };
        }
        if (flags & RedirectFlags.STDERR) {
          b.stderr = { kind: 'fd', writer: redirectWriter, captured: null };
        }
      } else if (!redirectReader) {
        fs.closeSync(fd);
      }
    } else if (node.redirectFile?.type === 'jsbuf') {
      await this.builtinJsRedirect(b, this.jsobj(node.redirectFile.idx), flags);
    } else if (flags & RedirectFlags.DUPLICATE_OUT) {
      if (flags & RedirectFlags.STDOUT) {
        b.stderr = b.stdout;
      }
      if (flags & RedirectFlags.STDERR) {
        b.stdout = b.stderr;
      }
    }
    try {
      return await (
        await builtinImpl(kind)
      )(b);
    } finally {
      redirectReader?.deref();
      await redirectWriter?.deref();
    }
  }

  async builtinJsRedirect(b, value, flags) {
    const wantsOut = Boolean(
      flags & (RedirectFlags.STDOUT | RedirectFlags.STDERR)
    );
    if (isArrayBufferLike(value)) {
      const view = byteView(value);
      if (flags & RedirectFlags.STDIN) {
        b.stdin = { kind: 'arraybuf', bytes: Buffer.from(view) };
      }
      if (flags & RedirectFlags.STDOUT) {
        b.stdout = { kind: 'arraybuf', view, i: 0 };
      }
      if (flags & RedirectFlags.STDERR) {
        b.stderr = { kind: 'arraybuf', view, i: 0 };
      }
      return;
    }
    if (isBodyValue(value)) {
      if (wantsOut) {
        // A builtin cannot write into a Response (Bun's builtin redirect).
        throw new ShellJsError(
          'Cannot redirect stdout/stderr to an immutable blob. Expected a file'
        );
      }
      const bytes = await bodyBytes(value);
      if (flags & RedirectFlags.STDIN) {
        b.stdin = { kind: 'blob', bytes };
      }
      if (flags & RedirectFlags.STDOUT) {
        b.stdout = { kind: 'blob' };
      }
      if (flags & RedirectFlags.STDERR) {
        b.stderr = { kind: 'blob' };
      }
      return;
    }
    const filePath = filePathOf(value);
    if (
      filePath !== null ||
      (typeof Blob === 'function' && value instanceof Blob)
    ) {
      if (wantsOut && filePath === null) {
        throw new ShellJsError(
          'Cannot redirect stdout/stderr to an immutable blob. Expected a file'
        );
      }
      if (flags & RedirectFlags.STDIN) {
        b.stdin = {
          kind: 'blob',
          bytes:
            filePath === null
              ? Buffer.from(await value.arrayBuffer())
              : await fs.promises.readFile(path.resolve(b.cwd, filePath)),
        };
      } else if (flags & RedirectFlags.STDOUT) {
        b.stdout = { kind: 'blob' };
      } else if (flags & RedirectFlags.STDERR) {
        b.stderr = { kind: 'blob' };
      }
      return;
    }
    throw unknownJsValue(value);
  }

  /**
   * Resolve a JS redirect target of an external command into
   * runSubprocess overrides (Bun's `init_subproc_redirections`).
   */
  async subprocJsRedirect(value, flags, shell, fds) {
    const overrides = {};
    const dupOut = flags & RedirectFlags.DUPLICATE_OUT;
    if (isArrayBufferLike(value)) {
      const view = byteView(value);
      if (flags & RedirectFlags.STDIN) {
        overrides.stdin = { bytes: Buffer.from(view) };
      }
      if (dupOut || flags & RedirectFlags.STDOUT) {
        overrides.stdout = { view };
      }
      if (dupOut || flags & RedirectFlags.STDERR) {
        overrides.stderr = { view };
      }
      return overrides;
    }
    const isBody = isBodyValue(value);
    const filePath = filePathOf(value);
    const isBlob = typeof Blob === 'function' && value instanceof Blob;
    if (!isBody && filePath === null && !isBlob) {
      throw unknownJsValue(value);
    }
    const blobTarget = async (which) => {
      if (filePath !== null) {
        const fd = openRedirectFile(
          shell.cwd,
          filePath,
          which === 'stdin' ? RedirectFlags.STDIN : RedirectFlags.STDOUT
        );
        fds.push(fd);
        return { fd };
      }
      if (which !== 'stdin') {
        throw new ShellJsError(
          'Blobs are immutable, and cannot be used for stdout/stderr'
        );
      }
      return {
        bytes: isBody
          ? await bodyBytes(value)
          : Buffer.from(await value.arrayBuffer()),
      };
    };
    const order = ['stdin', 'stdout', 'stderr'];
    const bits = [
      RedirectFlags.STDIN,
      RedirectFlags.STDOUT,
      RedirectFlags.STDERR,
    ];
    for (let i = 0; i < 3; i++) {
      if (flags & bits[i]) {
        overrides[order[i]] = await blobTarget(order[i]);
        if (!isBody) {
          break;
        }
      }
    }
    return overrides;
  }

  async runExternal(args, node, redirectFile, shell, io) {
    const env = envObject(shell);
    const pathEnv =
      Object.entries(env).find(([k]) =>
        IS_WINDOWS ? k.toUpperCase() === 'PATH' : k === 'PATH'
      )?.[1] ?? '';
    let resolved = which(pathEnv, shell.cwd, args[0]);
    if (resolved === null && (args[0] === 'bun' || args[0] === 'bun-debug')) {
      resolved = process.execPath;
    }
    if (resolved === null) {
      return this.cmdWriteFailingError(
        io,
        shell,
        `bun: command not found: ${args[0]}\n`
      );
    }
    if (IS_WINDOWS && /\.(bat|cmd)$/i.test(resolved)) {
      const unsafe = args.slice(1).find((a) => /[&|<>^%"\r\n]/.test(a));
      if (unsafe !== undefined) {
        return this.cmdWriteFailingError(
          io,
          shell,
          `bun: refusing to pass argument with cmd.exe special characters to a batch file: ${unsafe}\n`
        );
      }
    }
    const argv = [resolved, ...args.slice(1)];
    const flags = node.redirect;
    let overrides = {};
    let dup = null;
    const fds = [];
    try {
      if (node.redirectFile?.type === 'atom') {
        if (redirectFile === '') {
          return await this.cmdWriteFailingError(
            io,
            shell,
            `bun: ambiguous redirect: at \`${argv[0]}\`\n`
          );
        }
        let fd;
        try {
          fd = openRedirectFile(shell.cwd, redirectFile, flags);
        } catch (e) {
          return await this.cmdWriteFailingError(
            io,
            shell,
            `bun: ${e.message}: ${redirectFile}`
          );
        }
        fds.push(fd);
        overrides = redirectOverridesForFd(flags, fd);
      } else if (node.redirectFile?.type === 'jsbuf') {
        overrides = await this.subprocJsRedirect(
          this.jsobj(node.redirectFile.idx),
          flags,
          shell,
          fds
        );
      } else if (flags & RedirectFlags.DUPLICATE_OUT) {
        if (flags & RedirectFlags.STDOUT) {
          dup = 'stderr-to-stdout';
        } else if (flags & RedirectFlags.STDERR) {
          dup = 'stdout-to-stderr';
        }
      }
      const result = await runSubprocess({
        args: argv,
        cwd: shell.cwd,
        env,
        io,
        flags,
        overrides,
        dup,
        shell,
        onSpawn: () => closeAll(fds),
      });
      if (result.spawnError) {
        return await this.cmdWriteFailingError(
          io,
          shell,
          `${spawnErrorMessage(result.spawnError, argv[0])}\n`
        );
      }
      return result.exitCode;
    } finally {
      closeAll(fds);
    }
  }
}

function closeAll(fds) {
  for (const fd of fds.splice(0)) {
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed.
    }
  }
}

/** Bun's `set_stdio_from_redirect`. */
function redirectOverridesForFd(flags, fd) {
  const overrides = {};
  if (flags & RedirectFlags.STDIN) {
    overrides.stdin = { fd };
  }
  if (flags & RedirectFlags.DUPLICATE_OUT) {
    overrides.stdout = { fd };
    overrides.stderr = { fd };
  } else {
    if (flags & RedirectFlags.STDOUT) {
      overrides.stdout = { fd };
    }
    if (flags & RedirectFlags.STDERR) {
      overrides.stderr = { fd };
    }
  }
  return overrides;
}

function spawnErrorMessage(err, file) {
  if (typeof err?.code === 'string') {
    return new ShellSysError(err.code, { path: file }).display();
  }
  return String(err?.message ?? err);
}

function displayErr(e) {
  if (typeof e?.display === 'function') {
    return e.display();
  }
  throw e;
}
