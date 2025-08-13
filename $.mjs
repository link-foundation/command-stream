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

// Virtual command registry - unified system for all commands
const virtualCommands = new Map();

// Global flag to enable/disable virtual commands (for backward compatibility)
let virtualCommandsEnabled = true;

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
    
    // Handle programmatic pipeline mode
    if (this.spec.mode === 'pipeline') {
      return await this._runProgrammaticPipeline(this.spec.source, this.spec.destination);
    }
    
    // Check if this is a virtual command first
    if (this.spec.mode === 'shell') {
      // Parse the command to check for virtual commands or pipelines
      const parsed = this._parseCommand(this.spec.command);
      if (parsed) {
        if (parsed.type === 'pipeline') {
          return await this._runPipeline(parsed.commands);
        } else if (parsed.type === 'simple' && virtualCommandsEnabled && virtualCommands.has(parsed.cmd)) {
          return await this._runVirtual(parsed.cmd, parsed.args);
        }
      }
    }
    
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

  _parseCommand(command) {
    const trimmed = command.trim();
    if (!trimmed) return null;
    
    // Check for pipes
    if (trimmed.includes('|')) {
      return this._parsePipeline(trimmed);
    }
    
    // Simple command parsing
    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (parts.length === 0) return null;
    
    const cmd = parts[0];
    const args = parts.slice(1).map(arg => {
      // Remove quotes if present
      if ((arg.startsWith('"') && arg.endsWith('"')) || 
          (arg.startsWith("'") && arg.endsWith("'"))) {
        return arg.slice(1, -1);
      }
      return arg;
    });
    
    return { cmd, args, type: 'simple' };
  }

  _parsePipeline(command) {
    // Split by pipe, respecting quotes
    const segments = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
        current += char;
      } else if (!inQuotes && char === '|') {
        segments.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      segments.push(current.trim());
    }
    
    // Parse each segment as a simple command
    const commands = segments.map(segment => {
      const parts = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      if (parts.length === 0) return null;
      
      const cmd = parts[0];
      const args = parts.slice(1).map(arg => {
        if ((arg.startsWith('"') && arg.endsWith('"')) || 
            (arg.startsWith("'") && arg.endsWith("'"))) {
          return arg.slice(1, -1);
        }
        return arg;
      });
      
      return { cmd, args };
    }).filter(Boolean);
    
    return { type: 'pipeline', commands };
  }

  async _runVirtual(cmd, args) {
    const handler = virtualCommands.get(cmd);
    if (!handler) {
      throw new Error(`Virtual command not found: ${cmd}`);
    }

    try {
      // Prepare stdin
      let stdinData = '';
      if (this.options.stdin && typeof this.options.stdin === 'string') {
        stdinData = this.options.stdin;
      } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
        stdinData = this.options.stdin.toString('utf8');
      }

      // Shell tracing for virtual commands
      if (globalShellSettings.xtrace) {
        console.log(`+ ${cmd} ${args.join(' ')}`);
      }
      if (globalShellSettings.verbose) {
        console.log(`${cmd} ${args.join(' ')}`);
      }

      // Execute the virtual command
      let result;
      
      // Check if handler is async generator (streaming)
      if (handler.constructor.name === 'AsyncGeneratorFunction') {
        // Handle streaming virtual command
        const chunks = [];
        for await (const chunk of handler(args, stdinData, this.options)) {
          const buf = Buffer.from(chunk);
          chunks.push(buf);
          
          if (this.options.mirror) {
            process.stdout.write(buf);
          }
          
          this.emit('stdout', buf);
          this.emit('data', { type: 'stdout', data: buf });
        }
        
        result = {
          code: 0,
          stdout: this.options.capture ? Buffer.concat(chunks).toString('utf8') : undefined,
          stderr: this.options.capture ? '' : undefined,
          stdin: this.options.capture ? stdinData : undefined
        };
      } else {
        // Regular async function
        result = await handler(args, stdinData, this.options);
        
        // Ensure result has required fields, respecting capture option
        result = {
          code: result.code ?? 0,
          stdout: this.options.capture ? (result.stdout ?? '') : undefined,
          stderr: this.options.capture ? (result.stderr ?? '') : undefined,
          stdin: this.options.capture ? stdinData : undefined,
          ...result
        };
        
        // Mirror and emit output
        if (result.stdout) {
          const buf = Buffer.from(result.stdout);
          if (this.options.mirror) {
            process.stdout.write(buf);
          }
          this.emit('stdout', buf);
          this.emit('data', { type: 'stdout', data: buf });
        }
        
        if (result.stderr) {
          const buf = Buffer.from(result.stderr);
          if (this.options.mirror) {
            process.stderr.write(buf);
          }
          this.emit('stderr', buf);
          this.emit('data', { type: 'stderr', data: buf });
        }
      }

      // Store result
      this.result = result;
      this.finished = true;
      
      // Emit completion events
      this.emit('end', result);
      this.emit('exit', result.code);
      
      // Handle shell settings
      if (globalShellSettings.errexit && result.code !== 0) {
        const error = new Error(`Command failed with exit code ${result.code}`);
        error.code = result.code;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        error.result = result;
        throw error;
      }
      
      return result;
    } catch (error) {
      // Handle errors from virtual commands
      const result = {
        code: error.code ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        stdin: ''
      };
      
      this.result = result;
      this.finished = true;
      
      if (result.stderr) {
        const buf = Buffer.from(result.stderr);
        if (this.options.mirror) {
          process.stderr.write(buf);
        }
        this.emit('stderr', buf);
        this.emit('data', { type: 'stderr', data: buf });
      }
      
      this.emit('end', result);
      this.emit('exit', result.code);
      
      if (globalShellSettings.errexit) {
        throw error;
      }
      
      return result;
    }
  }

  async _runPipeline(commands) {
    if (commands.length === 0) {
      return { code: 1, stdout: '', stderr: 'No commands in pipeline', stdin: '' };
    }

    let currentOutput = '';
    let currentInput = '';
    
    // Get initial stdin from options
    if (this.options.stdin && typeof this.options.stdin === 'string') {
      currentInput = this.options.stdin;
    } else if (this.options.stdin && Buffer.isBuffer(this.options.stdin)) {
      currentInput = this.options.stdin.toString('utf8');
    }

    // Execute each command in the pipeline
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const { cmd, args } = command;
      
      // Check if this is a virtual command
      if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
        // Run virtual command with current input
        const handler = virtualCommands.get(cmd);
        
        try {
          // Shell tracing for virtual commands
          if (globalShellSettings.xtrace) {
            console.log(`+ ${cmd} ${args.join(' ')}`);
          }
          if (globalShellSettings.verbose) {
            console.log(`${cmd} ${args.join(' ')}`);
          }

          let result;
          
          // Check if handler is async generator (streaming)
          if (handler.constructor.name === 'AsyncGeneratorFunction') {
            const chunks = [];
            for await (const chunk of handler(args, currentInput, this.options)) {
              chunks.push(Buffer.from(chunk));
            }
            result = {
              code: 0,
              stdout: this.options.capture ? Buffer.concat(chunks).toString('utf8') : undefined,
              stderr: this.options.capture ? '' : undefined,
              stdin: this.options.capture ? currentInput : undefined
            };
          } else {
            // Regular async function
            result = await handler(args, currentInput, this.options);
            result = {
              code: result.code ?? 0,
              stdout: this.options.capture ? (result.stdout ?? '') : undefined,
              stderr: this.options.capture ? (result.stderr ?? '') : undefined,
              stdin: this.options.capture ? currentInput : undefined,
              ...result
            };
          }
          
          // If this isn't the last command, pass stdout as stdin to next command
          if (i < commands.length - 1) {
            currentInput = result.stdout;
          } else {
            // This is the last command - emit output and store final result
            currentOutput = result.stdout;
            
            // Mirror and emit output for final command
            if (result.stdout) {
              const buf = Buffer.from(result.stdout);
              if (this.options.mirror) {
                process.stdout.write(buf);
              }
              this.emit('stdout', buf);
              this.emit('data', { type: 'stdout', data: buf });
            }
            
            if (result.stderr) {
              const buf = Buffer.from(result.stderr);
              if (this.options.mirror) {
                process.stderr.write(buf);
              }
              this.emit('stderr', buf);
              this.emit('data', { type: 'stderr', data: buf });
            }
            
            // Store final result
            const finalResult = {
              code: result.code,
              stdout: currentOutput,
              stderr: result.stderr,
              stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin : 
                     this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
            };
            
            this.result = finalResult;
            this.finished = true;
            
            // Emit completion events
            this.emit('end', finalResult);
            this.emit('exit', finalResult.code);
            
            // Handle shell settings
            if (globalShellSettings.errexit && finalResult.code !== 0) {
              const error = new Error(`Pipeline failed with exit code ${finalResult.code}`);
              error.code = finalResult.code;
              error.stdout = finalResult.stdout;
              error.stderr = finalResult.stderr;
              error.result = finalResult;
              throw error;
            }
            
            return finalResult;
          }
          
          // Handle errors from intermediate commands
          if (globalShellSettings.errexit && result.code !== 0) {
            const error = new Error(`Pipeline command failed with exit code ${result.code}`);
            error.code = result.code;
            error.stdout = result.stdout;
            error.stderr = result.stderr;
            error.result = result;
            throw error;
          }
        } catch (error) {
          // Handle errors from virtual commands in pipeline
          const result = {
            code: error.code ?? 1,
            stdout: currentOutput,
            stderr: error.stderr ?? error.message,
            stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin : 
                   this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
          };
          
          this.result = result;
          this.finished = true;
          
          if (result.stderr) {
            const buf = Buffer.from(result.stderr);
            if (this.options.mirror) {
              process.stderr.write(buf);
            }
            this.emit('stderr', buf);
            this.emit('data', { type: 'stderr', data: buf });
          }
          
          this.emit('end', result);
          this.emit('exit', result.code);
          
          if (globalShellSettings.errexit) {
            throw error;
          }
          
          return result;
        }
      } else {
        // For system commands in pipeline, we would need to spawn processes
        // For now, return an error indicating this isn't supported
        const result = {
          code: 1,
          stdout: currentOutput,
          stderr: `Pipeline with system command '${cmd}' not yet supported`,
          stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin : 
                 this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
        };
        
        this.result = result;
        this.finished = true;
        
        const buf = Buffer.from(result.stderr);
        if (this.options.mirror) {
          process.stderr.write(buf);
        }
        this.emit('stderr', buf);
        this.emit('data', { type: 'stderr', data: buf });
        
        this.emit('end', result);
        this.emit('exit', result.code);
        
        return result;
      }
    }
  }

  // Run programmatic pipeline (.pipe() method)
  async _runProgrammaticPipeline(source, destination) {
    try {
      // Execute the source command first
      const sourceResult = await source;
      
      if (sourceResult.code !== 0) {
        // If source failed, return its result
        return sourceResult;
      }
      
      // Set the destination's stdin to the source's stdout
      destination.options = {
        ...destination.options,
        stdin: sourceResult.stdout
      };
      
      // Execute the destination command
      const destResult = await destination;
      
      // Return the final result with combined information
      return {
        code: destResult.code,
        stdout: destResult.stdout,
        stderr: sourceResult.stderr + destResult.stderr,
        stdin: sourceResult.stdin
      };
      
    } catch (error) {
      const result = {
        code: error.code ?? 1,
        stdout: '',
        stderr: error.message || 'Pipeline execution failed',
        stdin: this.options.stdin && typeof this.options.stdin === 'string' ? this.options.stdin : 
               this.options.stdin && Buffer.isBuffer(this.options.stdin) ? this.options.stdin.toString('utf8') : ''
      };
      
      this.result = result;
      this.finished = true;
      
      const buf = Buffer.from(result.stderr);
      if (this.options.mirror) {
        process.stderr.write(buf);
      }
      this.emit('stderr', buf);
      this.emit('data', { type: 'stderr', data: buf });
      
      this.emit('end', result);
      this.emit('exit', result.code);
      
      return result;
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

  // Programmatic piping support
  pipe(destination) {
    // If destination is a ProcessRunner, create a pipeline
    if (destination instanceof ProcessRunner) {
      // Create a new ProcessRunner that represents the piped operation
      const pipeSpec = {
        mode: 'pipeline',
        source: this,
        destination: destination
      };
      
      return new ProcessRunner(pipeSpec, {
        ...this.options,
        capture: destination.options.capture ?? true
      });
    }
    
    // If destination is a template literal result (from $`command`), use its spec
    if (destination && destination.spec) {
      const destRunner = new ProcessRunner(destination.spec, destination.options);
      return this.pipe(destRunner);
    }
    
    throw new Error('pipe() destination must be a ProcessRunner or $`command` result');
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

// Virtual command registration API
function register(name, handler) {
  virtualCommands.set(name, handler);
  return virtualCommands;
}

function unregister(name) {
  return virtualCommands.delete(name);
}

function listCommands() {
  return Array.from(virtualCommands.keys());
}

function enableVirtualCommands() {
  virtualCommandsEnabled = true;
  return virtualCommandsEnabled;
}

function disableVirtualCommands() {
  virtualCommandsEnabled = false;
  return virtualCommandsEnabled;
}

// Built-in commands that match Bun.$ functionality
function registerBuiltins() {
  // cd - change directory
  register('cd', async (args) => {
    const target = args[0] || process.env.HOME || process.env.USERPROFILE || '/';
    try {
      process.chdir(target);
      return { stdout: process.cwd(), code: 0 };
    } catch (error) {
      return { stderr: `cd: ${error.message}`, code: 1 };
    }
  });

  // pwd - print working directory
  register('pwd', async (args, stdin, options) => {
    // If cwd option is provided, return that instead of process.cwd()
    const dir = options?.cwd || process.cwd();
    return { stdout: dir, code: 0 };
  });

  // echo - print arguments
  register('echo', async (args) => {
    let output = args.join(' ');
    if (args.includes('-n')) {
      // Don't add newline
      output = args.filter(arg => arg !== '-n').join(' ');
    } else {
      output += '\n';
    }
    return { stdout: output, code: 0 };
  });

  // sleep - wait for specified time
  register('sleep', async (args) => {
    const seconds = parseFloat(args[0] || 0);
    if (isNaN(seconds) || seconds < 0) {
      return { stderr: 'sleep: invalid time interval', code: 1 };
    }
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return { stdout: '', code: 0 };
  });

  // true - always succeed
  register('true', async () => {
    return { stdout: '', code: 0 };
  });

  // false - always fail
  register('false', async () => {
    return { stdout: '', code: 1 };
  });

  // which - locate command
  register('which', async (args) => {
    if (args.length === 0) {
      return { stderr: 'which: missing operand', code: 1 };
    }
    
    const cmd = args[0];
    
    // Check virtual commands first
    if (virtualCommands.has(cmd)) {
      return { stdout: `${cmd}: shell builtin\n`, code: 0 };
    }
    
    // Check PATH for system commands
    const paths = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
    const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
    
    for (const path of paths) {
      for (const ext of extensions) {
        const fullPath = require('path').join(path, cmd + ext);
        try {
          if (require('fs').statSync(fullPath).isFile()) {
            return { stdout: fullPath, code: 0 };
          }
        } catch {}
      }
    }
    
    return { stderr: `which: no ${cmd} in PATH`, code: 1 };
  });

  // exit - exit with code
  register('exit', async (args) => {
    const code = parseInt(args[0] || 0);
    if (globalShellSettings.errexit || code !== 0) {
      // For virtual commands, we simulate exit by returning the code
      return { stdout: '', code };
    }
    return { stdout: '', code: 0 };
  });

  // env - print environment variables
  register('env', async (args, stdin, options) => {
    if (args.length === 0) {
      // Use custom env if provided, otherwise use process.env
      const env = options?.env || process.env;
      const output = Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n';
      return { stdout: output, code: 0 };
    }
    
    // TODO: Support env VAR=value command syntax
    return { stderr: 'env: command execution not yet supported', code: 1 };
  });

  // cat - read and display file contents
  register('cat', async (args, stdin, options) => {
    if (args.length === 0) {
      // Read from stdin if no files specified
      return { stdout: stdin || '', code: 0 };
    }
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      let output = '';
      
      for (const filename of args) {
        // Handle special flags
        if (filename === '-n') continue; // Line numbering (basic support)
        
        try {
          // Resolve path relative to cwd if provided
          const basePath = options?.cwd || process.cwd();
          const fullPath = path.isAbsolute(filename) ? filename : path.join(basePath, filename);
          
          const content = fs.readFileSync(fullPath, 'utf8');
          output += content;
        } catch (error) {
          // Format error message to match bash/sh style
          const errorMsg = error.code === 'ENOENT' ? 'No such file or directory' : error.message;
          return { 
            stderr: `cat: ${filename}: ${errorMsg}`, 
            stdout: output,
            code: 1 
          };
        }
      }
      
      return { stdout: output, code: 0 };
    } catch (error) {
      return { stderr: `cat: ${error.message}`, code: 1 };
    }
  });

  // ls - list directory contents
  register('ls', async (args, stdin, options) => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Parse flags and paths
      const flags = args.filter(arg => arg.startsWith('-'));
      const paths = args.filter(arg => !arg.startsWith('-'));
      const isLongFormat = flags.includes('-l');
      const showAll = flags.includes('-a');
      const showAlmostAll = flags.includes('-A');
      
      // Default to current directory if no paths specified
      const targetPaths = paths.length > 0 ? paths : ['.'];
      
      let output = '';
      
      for (const targetPath of targetPaths) {
        // Resolve path relative to cwd if provided
        const basePath = options?.cwd || process.cwd();
        const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(basePath, targetPath);
        
        try {
          const stat = fs.statSync(fullPath);
          
          if (stat.isFile()) {
            // Just show the file name if it's a file
            output += path.basename(targetPath) + '\n';
          } else if (stat.isDirectory()) {
            const entries = fs.readdirSync(fullPath);
            
            // Filter hidden files unless -a or -A is specified
            let filteredEntries = entries;
            if (!showAll && !showAlmostAll) {
              filteredEntries = entries.filter(entry => !entry.startsWith('.'));
            } else if (showAlmostAll) {
              filteredEntries = entries.filter(entry => entry !== '.' && entry !== '..');
            }
            
            if (isLongFormat) {
              // Long format: permissions, links, owner, group, size, date, name
              for (const entry of filteredEntries) {
                const entryPath = path.join(fullPath, entry);
                try {
                  const entryStat = fs.statSync(entryPath);
                  const isDir = entryStat.isDirectory();
                  const permissions = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
                  const size = entryStat.size.toString().padStart(8);
                  const date = entryStat.mtime.toISOString().slice(0, 16).replace('T', ' ');
                  output += `${permissions} 1 user group ${size} ${date} ${entry}\n`;
                } catch {
                  output += `?????????? 1 user group        ? ??? ?? ??:?? ${entry}\n`;
                }
              }
            } else {
              // Simple format: just names
              output += filteredEntries.join('\n') + (filteredEntries.length > 0 ? '\n' : '');
            }
          }
        } catch (error) {
          return { 
            stderr: `ls: cannot access '${targetPath}': ${error.message}`, 
            code: 2 
          };
        }
      }
      
      return { stdout: output, code: 0 };
    } catch (error) {
      return { stderr: `ls: ${error.message}`, code: 1 };
    }
  });

  // mkdir - create directories
  register('mkdir', async (args, stdin, options) => {
    if (args.length === 0) {
      return { stderr: 'mkdir: missing operand', code: 1 };
    }
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const flags = args.filter(arg => arg.startsWith('-'));
      const dirs = args.filter(arg => !arg.startsWith('-'));
      const recursive = flags.includes('-p');
      
      for (const dir of dirs) {
        try {
          const basePath = options?.cwd || process.cwd();
          const fullPath = path.isAbsolute(dir) ? dir : path.join(basePath, dir);
          
          if (recursive) {
            fs.mkdirSync(fullPath, { recursive: true });
          } else {
            fs.mkdirSync(fullPath);
          }
        } catch (error) {
          return { 
            stderr: `mkdir: cannot create directory '${dir}': ${error.message}`, 
            code: 1 
          };
        }
      }
      
      return { stdout: '', code: 0 };
    } catch (error) {
      return { stderr: `mkdir: ${error.message}`, code: 1 };
    }
  });

  // rm - remove files and directories
  register('rm', async (args, stdin, options) => {
    if (args.length === 0) {
      return { stderr: 'rm: missing operand', code: 1 };
    }
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const flags = args.filter(arg => arg.startsWith('-'));
      const targets = args.filter(arg => !arg.startsWith('-'));
      const recursive = flags.includes('-r') || flags.includes('-R');
      const force = flags.includes('-f');
      
      for (const target of targets) {
        try {
          const basePath = options?.cwd || process.cwd();
          const fullPath = path.isAbsolute(target) ? target : path.join(basePath, target);
          
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            if (!recursive) {
              return { 
                stderr: `rm: cannot remove '${target}': Is a directory`, 
                code: 1 
              };
            }
            fs.rmSync(fullPath, { recursive: true, force });
          } else {
            fs.unlinkSync(fullPath);
          }
        } catch (error) {
          if (!force) {
            return { 
              stderr: `rm: cannot remove '${target}': ${error.message}`, 
              code: 1 
            };
          }
        }
      }
      
      return { stdout: '', code: 0 };
    } catch (error) {
      return { stderr: `rm: ${error.message}`, code: 1 };
    }
  });

  // mv - move/rename files and directories
  register('mv', async (args, stdin, options) => {
    if (args.length < 2) {
      return { stderr: 'mv: missing destination file operand', code: 1 };
    }
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const basePath = options?.cwd || process.cwd();
      
      if (args.length === 2) {
        // Simple rename/move
        const [source, dest] = args;
        const sourcePath = path.isAbsolute(source) ? source : path.join(basePath, source);
        let destPath = path.isAbsolute(dest) ? dest : path.join(basePath, dest);
        
        try {
          // Check if destination is an existing directory
          try {
            const destStat = fs.statSync(destPath);
            if (destStat.isDirectory()) {
              // Move file into the directory
              const fileName = path.basename(source);
              destPath = path.join(destPath, fileName);
            }
          } catch {
            // Destination doesn't exist, proceed with direct rename
          }
          
          fs.renameSync(sourcePath, destPath);
        } catch (error) {
          return { 
            stderr: `mv: cannot move '${source}' to '${dest}': ${error.message}`, 
            code: 1 
          };
        }
      } else {
        // Multiple sources to directory
        const sources = args.slice(0, -1);
        const dest = args[args.length - 1];
        const destPath = path.isAbsolute(dest) ? dest : path.join(basePath, dest);
        
        // Check if destination is a directory
        try {
          const destStat = fs.statSync(destPath);
          if (!destStat.isDirectory()) {
            return { 
              stderr: `mv: target '${dest}' is not a directory`, 
              code: 1 
            };
          }
        } catch {
          return { 
            stderr: `mv: cannot access '${dest}': No such file or directory`, 
            code: 1 
          };
        }
        
        for (const source of sources) {
          try {
            const sourcePath = path.isAbsolute(source) ? source : path.join(basePath, source);
            const fileName = path.basename(source);
            const newDestPath = path.join(destPath, fileName);
            fs.renameSync(sourcePath, newDestPath);
          } catch (error) {
            return { 
              stderr: `mv: cannot move '${source}' to '${dest}': ${error.message}`, 
              code: 1 
            };
          }
        }
      }
      
      return { stdout: '', code: 0 };
    } catch (error) {
      return { stderr: `mv: ${error.message}`, code: 1 };
    }
  });

  // cp - copy files and directories
  register('cp', async (args, stdin, options) => {
    if (args.length < 2) {
      return { stderr: 'cp: missing destination file operand', code: 1 };
    }
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const flags = args.filter(arg => arg.startsWith('-'));
      const paths = args.filter(arg => !arg.startsWith('-'));
      const recursive = flags.includes('-r') || flags.includes('-R');
      
      const basePath = options?.cwd || process.cwd();
      
      if (paths.length === 2) {
        // Simple copy
        const [source, dest] = paths;
        const sourcePath = path.isAbsolute(source) ? source : path.join(basePath, source);
        const destPath = path.isAbsolute(dest) ? dest : path.join(basePath, dest);
        
        try {
          const sourceStat = fs.statSync(sourcePath);
          
          if (sourceStat.isDirectory()) {
            if (!recursive) {
              return { 
                stderr: `cp: -r not specified; omitting directory '${source}'`, 
                code: 1 
              };
            }
            fs.cpSync(sourcePath, destPath, { recursive: true });
          } else {
            fs.copyFileSync(sourcePath, destPath);
          }
        } catch (error) {
          return { 
            stderr: `cp: cannot copy '${source}' to '${dest}': ${error.message}`, 
            code: 1 
          };
        }
      } else {
        // Multiple sources to directory
        const sources = paths.slice(0, -1);
        const dest = paths[paths.length - 1];
        const destPath = path.isAbsolute(dest) ? dest : path.join(basePath, dest);
        
        // Check if destination is a directory
        try {
          const destStat = fs.statSync(destPath);
          if (!destStat.isDirectory()) {
            return { 
              stderr: `cp: target '${dest}' is not a directory`, 
              code: 1 
            };
          }
        } catch {
          return { 
            stderr: `cp: cannot access '${dest}': No such file or directory`, 
            code: 1 
          };
        }
        
        for (const source of sources) {
          try {
            const sourcePath = path.isAbsolute(source) ? source : path.join(basePath, source);
            const fileName = path.basename(source);
            const newDestPath = path.join(destPath, fileName);
            
            const sourceStat = fs.statSync(sourcePath);
            if (sourceStat.isDirectory()) {
              if (!recursive) {
                return { 
                  stderr: `cp: -r not specified; omitting directory '${source}'`, 
                  code: 1 
                };
              }
              fs.cpSync(sourcePath, newDestPath, { recursive: true });
            } else {
              fs.copyFileSync(sourcePath, newDestPath);
            }
          } catch (error) {
            return { 
              stderr: `cp: cannot copy '${source}' to '${dest}': ${error.message}`, 
              code: 1 
            };
          }
        }
      }
      
      return { stdout: '', code: 0 };
    } catch (error) {
      return { stderr: `cp: ${error.message}`, code: 1 };
    }
  });

  // touch - create or update file timestamps
  register('touch', async (args, stdin, options) => {
    if (args.length === 0) {
      return { stderr: 'touch: missing file operand', code: 1 };
    }
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const basePath = options?.cwd || process.cwd();
      
      for (const file of args) {
        try {
          const fullPath = path.isAbsolute(file) ? file : path.join(basePath, file);
          
          // Try to update timestamps if file exists
          try {
            const now = new Date();
            fs.utimesSync(fullPath, now, now);
          } catch {
            // File doesn't exist, create it
            fs.writeFileSync(fullPath, '', { flag: 'w' });
          }
        } catch (error) {
          return { 
            stderr: `touch: cannot touch '${file}': ${error.message}`, 
            code: 1 
          };
        }
      }
      
      return { stdout: '', code: 0 };
    } catch (error) {
      return { stderr: `touch: ${error.message}`, code: 1 };
    }
  });

  // basename - extract filename from path
  register('basename', async (args) => {
    if (args.length === 0) {
      return { stderr: 'basename: missing operand', code: 1 };
    }
    
    try {
      const path = await import('path');
      
      const pathname = args[0];
      const suffix = args[1];
      
      let result = path.basename(pathname);
      
      // Remove suffix if provided
      if (suffix && result.endsWith(suffix)) {
        result = result.slice(0, -suffix.length);
      }
      
      return { stdout: result + '\n', code: 0 };
    } catch (error) {
      return { stderr: `basename: ${error.message}`, code: 1 };
    }
  });

  // dirname - extract directory from path
  register('dirname', async (args) => {
    if (args.length === 0) {
      return { stderr: 'dirname: missing operand', code: 1 };
    }
    
    try {
      const path = await import('path');
      
      const pathname = args[0];
      const result = path.dirname(pathname);
      
      return { stdout: result + '\n', code: 0 };
    } catch (error) {
      return { stderr: `dirname: ${error.message}`, code: 1 };
    }
  });

  // yes - output a string repeatedly
  register('yes', async function* (args) {
    const output = args.length > 0 ? args.join(' ') : 'y';
    
    // Generate infinite stream of the output
    while (true) {
      yield output + '\n';
      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  });

  // seq - generate sequence of numbers
  register('seq', async (args) => {
    if (args.length === 0) {
      return { stderr: 'seq: missing operand', code: 1 };
    }
    
    try {
      let start, step, end;
      
      if (args.length === 1) {
        start = 1;
        step = 1;
        end = parseInt(args[0]);
      } else if (args.length === 2) {
        start = parseInt(args[0]);
        step = 1;
        end = parseInt(args[1]);
      } else if (args.length === 3) {
        start = parseInt(args[0]);
        step = parseInt(args[1]);
        end = parseInt(args[2]);
      } else {
        return { stderr: 'seq: too many operands', code: 1 };
      }
      
      if (isNaN(start) || isNaN(step) || isNaN(end)) {
        return { stderr: 'seq: invalid number', code: 1 };
      }
      
      let output = '';
      if (step > 0) {
        for (let i = start; i <= end; i += step) {
          output += i + '\n';
        }
      } else if (step < 0) {
        for (let i = start; i >= end; i += step) {
          output += i + '\n';
        }
      } else {
        return { stderr: 'seq: invalid increment', code: 1 };
      }
      
      return { stdout: output, code: 0 };
    } catch (error) {
      return { stderr: `seq: ${error.message}`, code: 1 };
    }
  });

  // test - test file conditions (basic implementation)
  register('test', async (args) => {
    if (args.length === 0) {
      return { stdout: '', code: 1 };
    }
    
    // Very basic test implementation
    const arg = args[0];
    
    try {
      if (arg === '-d' && args[1]) {
        // Test if directory
        const stat = require('fs').statSync(args[1]);
        return { stdout: '', code: stat.isDirectory() ? 0 : 1 };
      } else if (arg === '-f' && args[1]) {
        // Test if file
        const stat = require('fs').statSync(args[1]);
        return { stdout: '', code: stat.isFile() ? 0 : 1 };
      } else if (arg === '-e' && args[1]) {
        // Test if exists
        require('fs').statSync(args[1]);
        return { stdout: '', code: 0 };
      }
    } catch {
      return { stdout: '', code: 1 };
    }
    
    return { stdout: '', code: 1 };
  });
}

// Initialize built-in commands
registerBuiltins();

export { $tagged as $, sh, exec, run, quote, create, raw, ProcessRunner, shell, set, unset, register, unregister, listCommands, enableVirtualCommands, disableVirtualCommands };
export default $tagged;