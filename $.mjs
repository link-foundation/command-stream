// Enhanced $ shell utilities with streaming, async iteration, and EventEmitter support
// Usage patterns:
// 1. Classic await: const result = await $`command`
// 2. Async iteration: for await (const chunk of $`command`.stream()) { ... }
// 3. EventEmitter: $`command`.on('data', chunk => ...).on('end', result => ...)
// 4. Stream access: $`command`.stdout, $`command`.stderr

const isBun = typeof globalThis.Bun !== 'undefined';

// Global shell settings (like bash set -e / set +e)
let globalShellSettings = {
  errexit: false,    // set -e equivalent: exit on error
  verbose: false,    // set -v equivalent: print commands
  xtrace: false,     // set -x equivalent: trace execution
  pipefail: false,   // set -o pipefail equivalent: pipe failure detection
  nounset: false     // set -u equivalent: error on undefined variables
};

// EventEmitter-like implementation
class StreamEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
    return this;
  }

  emit(event, ...args) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(...args);
      }
    }
    return this;
  }

  off(event, listener) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
      }
    }
    return this;
  }
}

function quote(value) {
  if (value == null) return "''";
  if (Array.isArray(value)) return value.map(quote).join(' ');
  if (typeof value !== 'string') value = String(value);
  if (value === '') return "''";
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(strings, values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'raw')) {
        out += String(v.raw);
      } else {
        out += quote(v);
      }
    }
  }
  return out;
}

function asBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(chunk);
}

async function pumpReadable(readable, onChunk) {
  if (!readable) return;
  for await (const chunk of readable) {
    await onChunk(asBuffer(chunk));
  }
}

// Enhanced process runner with streaming capabilities
class ProcessRunner extends StreamEmitter {
  constructor(spec, options = {}) {
    super();
    this.spec = spec;
    this.options = {
      mirror: true,
      capture: true,
      stdin: 'inherit',
      cwd: undefined,
      env: undefined,
      ...options
    };
    
    this.outChunks = this.options.capture ? [] : null;
    this.errChunks = this.options.capture ? [] : null;
    this.inChunks = this.options.capture && this.options.stdin === 'inherit' ? [] : 
                   this.options.capture && (typeof this.options.stdin === 'string' || Buffer.isBuffer(this.options.stdin)) ? 
                   [Buffer.from(this.options.stdin)] : [];
    
    this.result = null;
    this.child = null;
    this.started = false;
    this.finished = false;
    
    // Promise for awaiting final result
    this.promise = null;
  }

  async _start() {
    if (this.started) return;
    this.started = true;

    const { cwd, env, stdin } = this.options;
    
    const spawnBun = (argv) => {
      return Bun.spawn(argv, { cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    };
    const spawnNode = async (argv) => {
      const cp = await import('child_process');
      return cp.spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    };

    const argv = this.spec.mode === 'shell' ? ['sh', '-lc', this.spec.command] : [this.spec.file, ...this.spec.args];
    
    // Shell tracing (set -x equivalent)
    if (globalShellSettings.xtrace) {
      const traceCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(`+ ${traceCmd}`);
    }
    
    // Verbose mode (set -v equivalent)
    if (globalShellSettings.verbose) {
      const verboseCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(verboseCmd);
    }
    
    const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
    const preferNodeForInput = isBun && needsExplicitPipe;
    this.child = preferNodeForInput ? await spawnNode(argv) : (isBun ? spawnBun(argv) : await spawnNode(argv));

    // Setup stdout streaming
    const outPump = pumpReadable(this.child.stdout, async (buf) => {
      if (this.options.capture) this.outChunks.push(buf);
      if (this.options.mirror) process.stdout.write(buf);
      
      // Emit chunk events
      this.emit('stdout', buf);
      this.emit('data', { type: 'stdout', data: buf });
    });

    // Setup stderr streaming  
    const errPump = pumpReadable(this.child.stderr, async (buf) => {
      if (this.options.capture) this.errChunks.push(buf);
      if (this.options.mirror) process.stderr.write(buf);
      
      // Emit chunk events
      this.emit('stderr', buf);
      this.emit('data', { type: 'stderr', data: buf });
    });

    // Handle stdin
    let stdinPumpPromise = Promise.resolve();
    if (stdin === 'inherit') {
      const isPipedIn = process.stdin && process.stdin.isTTY === false;
      if (isPipedIn) {
        stdinPumpPromise = this._pumpStdinTo(this.child, this.options.capture ? this.inChunks : null);
      } else {
        if (this.child.stdin && typeof this.child.stdin.end === 'function') {
          try { this.child.stdin.end(); } catch {}
        } else if (isBun && this.child.stdin && typeof this.child.stdin.getWriter === 'function') {
          try { const w = this.child.stdin.getWriter(); await w.close(); } catch {}
        }
      }
    } else if (stdin === 'ignore') {
      if (this.child.stdin && typeof this.child.stdin.end === 'function') this.child.stdin.end();
    } else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
      const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
      if (this.options.capture && this.inChunks) this.inChunks.push(Buffer.from(buf));
      stdinPumpPromise = this._writeToStdin(buf);
    }

    const exited = isBun ? this.child.exited : new Promise((resolve) => this.child.on('close', resolve));
    const code = await exited;
    await Promise.all([outPump, errPump, stdinPumpPromise]);

    this.result = {
      code,
      stdout: this.options.capture ? Buffer.concat(this.outChunks).toString('utf8') : undefined,
      stderr: this.options.capture ? Buffer.concat(this.errChunks).toString('utf8') : undefined,
      stdin: this.options.capture && this.inChunks ? Buffer.concat(this.inChunks).toString('utf8') : undefined,
      child: this.child
    };

    this.finished = true;
    this.emit('end', this.result);
    this.emit('exit', this.result.code);
    
    // Handle shell settings (set -e equivalent)
    if (globalShellSettings.errexit && this.result.code !== 0) {
      const error = new Error(`Command failed with exit code ${this.result.code}`);
      error.code = this.result.code;
      error.stdout = this.result.stdout;
      error.stderr = this.result.stderr;
      error.result = this.result;
      throw error;
    }
    
    return this.result;
  }

  async _pumpStdinTo(child, captureChunks) {
    if (!child.stdin) return;
    const bunWriter = isBun && child.stdin && typeof child.stdin.getWriter === 'function' ? child.stdin.getWriter() : null;
    for await (const chunk of process.stdin) {
      const buf = asBuffer(chunk);
      captureChunks && captureChunks.push(buf);
      if (bunWriter) await bunWriter.write(buf);
      else if (typeof child.stdin.write === 'function') child.stdin.write(buf);
      else if (isBun && typeof Bun.write === 'function') await Bun.write(child.stdin, buf);
    }
    if (bunWriter) await bunWriter.close();
    else if (typeof child.stdin.end === 'function') child.stdin.end();
  }

  async _writeToStdin(buf) {
    if (isBun && this.child.stdin && typeof this.child.stdin.getWriter === 'function') {
      const w = this.child.stdin.getWriter();
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength);
      await w.write(bytes);
      await w.close();
    } else if (this.child.stdin && typeof this.child.stdin.write === 'function') {
      this.child.stdin.end(buf);
    } else if (isBun && typeof Bun.write === 'function') {
      await Bun.write(this.child.stdin, buf);
    }
  }

  // Async iteration support
  async* stream() {
    if (!this.started) {
      this._start(); // Start but don't await
    }
    
    let buffer = [];
    let resolve, reject;
    let ended = false;

    const onData = (chunk) => {
      buffer.push(chunk);
      if (resolve) {
        resolve();
        resolve = reject = null;
      }
    };

    const onEnd = () => {
      ended = true;
      if (resolve) {
        resolve();
        resolve = reject = null;
      }
    };

    this.on('data', onData);
    this.on('end', onEnd);

    try {
      while (!ended || buffer.length > 0) {
        if (buffer.length > 0) {
          yield buffer.shift();
        } else if (!ended) {
          await new Promise((res, rej) => {
            resolve = res;
            reject = rej;
          });
        }
      }
    } finally {
      this.off('data', onData);
      this.off('end', onEnd);
    }
  }

  // Promise interface (for await)
  then(onFulfilled, onRejected) {
    if (!this.promise) {
      this.promise = this._start();
    }
    return this.promise.then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    if (!this.promise) {
      this.promise = this._start();
    }
    return this.promise.catch(onRejected);
  }

  finally(onFinally) {
    if (!this.promise) {
      this.promise = this._start();
    }
    return this.promise.finally(onFinally);
  }

  // Synchronous execution
  sync() {
    if (this.started) {
      throw new Error('Command already started - cannot run sync after async start');
    }
    
    const { cwd, env, stdin } = this.options;
    const argv = this.spec.mode === 'shell' ? ['sh', '-lc', this.spec.command] : [this.spec.file, ...this.spec.args];
    
    // Shell tracing (set -x equivalent)
    if (globalShellSettings.xtrace) {
      const traceCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(`+ ${traceCmd}`);
    }
    
    // Verbose mode (set -v equivalent)
    if (globalShellSettings.verbose) {
      const verboseCmd = this.spec.mode === 'shell' ? this.spec.command : argv.join(' ');
      console.log(verboseCmd);
    }
    
    let result;
    
    if (isBun) {
      // Use Bun's synchronous spawn
      const proc = Bun.spawnSync(argv, {
        cwd,
        env,
        stdin: typeof stdin === 'string' ? Buffer.from(stdin) : 
               Buffer.isBuffer(stdin) ? stdin : 
               stdin === 'ignore' ? undefined : undefined,
        stdout: 'pipe',
        stderr: 'pipe'
      });
      
      result = {
        code: proc.exitCode || 0,
        stdout: proc.stdout?.toString('utf8') || '',
        stderr: proc.stderr?.toString('utf8') || '',
        stdin: typeof stdin === 'string' ? stdin : 
               Buffer.isBuffer(stdin) ? stdin.toString('utf8') : '',
        child: proc
      };
    } else {
      // Use Node's synchronous spawn
      const cp = require('child_process');
      const proc = cp.spawnSync(argv[0], argv.slice(1), {
        cwd,
        env,
        input: typeof stdin === 'string' ? stdin : 
               Buffer.isBuffer(stdin) ? stdin : undefined,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      result = {
        code: proc.status || 0,
        stdout: proc.stdout || '',
        stderr: proc.stderr || '',
        stdin: typeof stdin === 'string' ? stdin : 
               Buffer.isBuffer(stdin) ? stdin.toString('utf8') : '',
        child: proc
      };
    }
    
    // Mirror output if requested (but always capture for result)
    if (this.options.mirror) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    
    // Store chunks for events (batched after completion)
    this.outChunks = result.stdout ? [Buffer.from(result.stdout)] : [];
    this.errChunks = result.stderr ? [Buffer.from(result.stderr)] : [];
    
    this.result = result;
    this.finished = true;
    
    // Emit batched events after completion
    if (result.stdout) {
      const stdoutBuf = Buffer.from(result.stdout);
      this.emit('stdout', stdoutBuf);
      this.emit('data', { type: 'stdout', data: stdoutBuf });
    }
    
    if (result.stderr) {
      const stderrBuf = Buffer.from(result.stderr);
      this.emit('stderr', stderrBuf);
      this.emit('data', { type: 'stderr', data: stderrBuf });
    }
    
    this.emit('end', result);
    this.emit('exit', result.code);
    
    // Handle shell settings (set -e equivalent)
    if (globalShellSettings.errexit && result.code !== 0) {
      const error = new Error(`Command failed with exit code ${result.code}`);
      error.code = result.code;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      error.result = result;
      throw error;
    }
    
    return result;
  }

  // Stream properties
  get stdout() {
    return this.child?.stdout;
  }

  get stderr() {
    return this.child?.stderr;
  }

  get stdin() {
    return this.child?.stdin;
  }
}

// Public APIs
async function sh(commandString, options = {}) {
  const runner = new ProcessRunner({ mode: 'shell', command: commandString }, options);
  return runner._start();
}

async function exec(file, args = [], options = {}) {
  const runner = new ProcessRunner({ mode: 'exec', file, args }, options);
  return runner._start();
}

async function run(commandOrTokens, options = {}) {
  if (typeof commandOrTokens === 'string') {
    return sh(commandOrTokens, { ...options, mirror: false, capture: true });
  }
  const [file, ...args] = commandOrTokens;
  return exec(file, args, { ...options, mirror: false, capture: true });
}

// Enhanced tagged template that returns ProcessRunner
function $tagged(strings, ...values) {
  const cmd = buildShellCommand(strings, values);
  return new ProcessRunner({ mode: 'shell', command: cmd }, { mirror: true, capture: true });
}

function create(defaultOptions = {}) {
  const tagged = (strings, ...values) => {
    const cmd = buildShellCommand(strings, values);
    return new ProcessRunner({ mode: 'shell', command: cmd }, { mirror: true, capture: true, ...defaultOptions });
  };
  return tagged;
}

function raw(value) { 
  return { raw: String(value) }; 
}

// Shell setting control functions (like bash set/unset)
function set(option) {
  const mapping = {
    'e': 'errexit',     // set -e: exit on error
    'errexit': 'errexit',
    'v': 'verbose',     // set -v: verbose
    'verbose': 'verbose', 
    'x': 'xtrace',      // set -x: trace execution
    'xtrace': 'xtrace',
    'u': 'nounset',     // set -u: error on unset vars
    'nounset': 'nounset',
    'o pipefail': 'pipefail',  // set -o pipefail
    'pipefail': 'pipefail'
  };
  
  if (mapping[option]) {
    globalShellSettings[mapping[option]] = true;
    if (globalShellSettings.verbose) {
      console.log(`+ set -${option}`);
    }
  }
  return globalShellSettings;
}

function unset(option) {
  const mapping = {
    'e': 'errexit',
    'errexit': 'errexit',
    'v': 'verbose', 
    'verbose': 'verbose',
    'x': 'xtrace',
    'xtrace': 'xtrace',
    'u': 'nounset',
    'nounset': 'nounset',
    'o pipefail': 'pipefail',
    'pipefail': 'pipefail'
  };
  
  if (mapping[option]) {
    globalShellSettings[mapping[option]] = false;
    if (globalShellSettings.verbose) {
      console.log(`+ set +${option}`);
    }
  }
  return globalShellSettings;
}

// Convenience functions for common patterns
const shell = {
  set,
  unset,
  settings: () => ({ ...globalShellSettings }),
  
  // Bash-like shortcuts
  errexit: (enable = true) => enable ? set('e') : unset('e'),
  verbose: (enable = true) => enable ? set('v') : unset('v'), 
  xtrace: (enable = true) => enable ? set('x') : unset('x'),
  pipefail: (enable = true) => enable ? set('o pipefail') : unset('o pipefail'),
  nounset: (enable = true) => enable ? set('u') : unset('u'),
};

export { $tagged as $, sh, exec, run, quote, create, raw, ProcessRunner, shell, set, unset };
export default $tagged;