// Dependency-free implementation of the `@webpod/ps` API.
//
// Cross-platform process listing, process-tree discovery and killing.
//
//   await lookup({ command: 'node' })     -> [{ pid, ppid, command, arguments }]
//   lookupSync({ pid: 123 })              -> [...]
//   await tree({ pid: 123, recursive: true }) -> descendants of 123
//   await kill(123, 'SIGTERM')            -> resolves once 123 is gone

import { execFile, spawnSync } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_PS_ARGS = '-eo pid,ppid,args';
const WIN_PS_SCRIPT =
  'Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId,ParentProcessId,CommandLine | ' +
  'ConvertTo-Json -Compress';
const WMIC_ARGS = ['process', 'get', 'ProcessId,ParentProcessId,CommandLine'];

// ---------------------------------------------------------------------------
// Command line helpers
// ---------------------------------------------------------------------------

/** Split a command line into tokens, honouring double quotes. */
function splitCommandLine(line) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

function makeEntry(pid, ppid, commandLine) {
  const line = String(commandLine || '').trim();
  const tokens = IS_WIN ? splitCommandLine(line) : line.split(/\s+/);
  const [command = '', ...args] = tokens.filter((t) => t !== '');
  return { pid: String(pid), ppid: String(ppid), command, arguments: args };
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

const CMD_COLUMNS = new Set(['CMD', 'COMMAND', 'ARGS']);

/**
 * Parse tabular text: `rowParser(headerLine)` returns a function turning a
 * data line into a process entry.
 */
function parseTable(stdout, rowParser) {
  const [header, ...rows] = String(stdout)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  return header === undefined ? [] : rows.map(rowParser(header));
}

function psRowParser(headerLine) {
  const header = headerLine.trim().split(/\s+/);
  const pidIdx = header.indexOf('PID');
  const ppidIdx = header.indexOf('PPID');
  const cmdIdx = header.findIndex((h) => CMD_COLUMNS.has(h));
  const cmdStart = cmdIdx === -1 ? header.length - 1 : cmdIdx;
  return (line) => {
    const cols = line.trim().split(/\s+/);
    const cmd = cols.slice(cmdStart).join(' ');
    return makeEntry(cols[pidIdx] || '', cols[ppidIdx] || '', cmd);
  };
}

function wmicRowParser(header) {
  const ppidPos = header.indexOf('ParentProcessId');
  const pidFirst = header.indexOf('ProcessId', ppidPos + 1) === -1;
  return (line) => {
    const nums = line.slice(ppidPos).trim().split(/\s+/);
    const [ppid, pid] = pidFirst ? [nums[1], nums[0]] : nums;
    return makeEntry(pid, ppid, line.slice(0, ppidPos));
  };
}

/** Parse the tabular output of `ps`. The last column may contain spaces. */
export function parsePsOutput(stdout) {
  return parseTable(stdout, psRowParser);
}

/** Parse the JSON produced by PowerShell `ConvertTo-Json`. */
function parsePowerShellOutput(stdout) {
  const text = String(stdout).trim();
  if (!text) {
    return [];
  }
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [data];
  return list.map((p) =>
    makeEntry(p.ProcessId, p.ParentProcessId, p.CommandLine)
  );
}

/** Parse the fixed-width output of `wmic process get ...`. */
function parseWmicOutput(stdout) {
  return parseTable(stdout, wmicRowParser);
}

// ---------------------------------------------------------------------------
// Process listing backends
// ---------------------------------------------------------------------------

/**
 * Candidate commands for listing processes on the current platform.
 * @returns {Array<{file: string, args: string[], parse: Function}>}
 */
function listingCommands(query) {
  if (!IS_WIN) {
    const psargs = query.psargs || DEFAULT_PS_ARGS;
    const args = Array.isArray(psargs)
      ? psargs
      : String(psargs).split(/\s+/).filter(Boolean);
    return [{ file: 'ps', args, parse: parsePsOutput }];
  }
  const psArgs = ['-NoProfile', '-NonInteractive', '-Command', WIN_PS_SCRIPT];
  return [
    { file: 'pwsh', args: psArgs, parse: parsePowerShellOutput },
    { file: 'powershell.exe', args: psArgs, parse: parsePowerShellOutput },
    { file: 'wmic', args: WMIC_ARGS, parse: parseWmicOutput },
  ];
}

function runListingSync(query) {
  let lastError = new Error('Unable to list processes');
  for (const { file, args, parse } of listingCommands(query)) {
    const res = spawnSync(file, args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    if (!res.error && res.status === 0) {
      return parse(res.stdout);
    }
    lastError = res.error || new Error(res.stderr || `${file} failed`);
  }
  throw lastError;
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', maxBuffer: MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

async function runListing(query) {
  let lastError = new Error('Unable to list processes');
  for (const { file, args, parse } of listingCommands(query)) {
    try {
      return parse(await execFileAsync(file, args));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function toList(value) {
  return (Array.isArray(value) ? value : [value]).map(String);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

/** Build a predicate from a lookup query. */
function makeFilter(query) {
  const pids = hasValue(query.pid) ? toList(query.pid) : null;
  const ppids = hasValue(query.ppid) ? toList(query.ppid) : null;
  const cmdRe = hasValue(query.command) ? new RegExp(query.command, 'i') : null;
  const argRe = hasValue(query.arguments)
    ? new RegExp(query.arguments, 'i')
    : null;
  return (p) =>
    (!pids || pids.includes(p.pid)) &&
    (!ppids || ppids.includes(p.ppid)) &&
    (!cmdRe || cmdRe.test(p.command)) &&
    (!argRe || argRe.test(p.arguments.join(' ')));
}

function normalizeQuery(query) {
  if (query === null || query === undefined || typeof query === 'function') {
    return {};
  }
  if (typeof query !== 'object' || Array.isArray(query)) {
    return { pid: query };
  }
  return query;
}

/** Attach an optional node-style callback to a promise. */
function withCallback(promise, cb) {
  if (typeof cb === 'function') {
    promise.then(
      (res) => cb(null, res),
      (err) => cb(err)
    );
  }
  return promise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronously list processes matching `query`.
 * @param {{pid?: any, ppid?: any, command?: string, arguments?: string, psargs?: string}} [query]
 */
export function lookupSync(query = {}) {
  const q = normalizeQuery(query);
  return runListingSync(q).filter(makeFilter(q));
}

/**
 * List processes matching `query`.
 * @returns {Promise<Array<{pid: string, ppid: string, command: string, arguments: string[]}>>}
 */
export function lookup(query = {}, cb) {
  const callback = typeof query === 'function' ? query : cb;
  const q = normalizeQuery(query);
  const promise = runListing(q).then((list) => list.filter(makeFilter(q)));
  return withCallback(promise, callback);
}
lookup.sync = lookupSync;

function normalizeTreeOpts(opts) {
  const o = typeof opts === 'object' && opts !== null ? opts : { pid: opts };
  if (!hasValue(o.pid)) {
    throw new Error('The pid is required');
  }
  return { pid: String(o.pid), recursive: !!o.recursive };
}

/** Collect children (or all descendants) of `pid` from a process list. */
function collectChildren(list, pid, recursive) {
  const result = [];
  const seen = new Set([pid]);
  let parents = [pid];
  while (parents.length > 0) {
    const kids = list.filter(
      (p) => parents.includes(p.ppid) && !seen.has(p.pid)
    );
    kids.forEach((k) => seen.add(k.pid));
    result.push(...kids);
    parents = recursive ? kids.map((k) => k.pid) : [];
  }
  return result;
}

/** Synchronously find the children of a process. */
export function treeSync(opts) {
  const { pid, recursive } = normalizeTreeOpts(opts);
  return collectChildren(lookupSync(), pid, recursive);
}

/**
 * Find the children (or all descendants when `recursive`) of a process.
 * @param {number|string|{pid: number|string, recursive?: boolean}} opts
 */
export function tree(opts, cb) {
  let promise;
  try {
    const { pid, recursive } = normalizeTreeOpts(opts);
    promise = lookup().then((list) => collectChildren(list, pid, recursive));
  } catch (err) {
    promise = Promise.reject(err);
  }
  return withCallback(promise, cb);
}
tree.sync = treeSync;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function waitForExit(pid, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!processExists(pid)) {
        resolve(String(pid));
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Kill process timeout'));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function normalizeKillOpts(opts) {
  if (typeof opts === 'string' || typeof opts === 'number') {
    return { signal: opts, timeout: 30 };
  }
  const o = opts && typeof opts === 'object' ? opts : {};
  return { signal: o.signal || 'SIGTERM', timeout: o.timeout ?? 30 };
}

/**
 * Send a signal to a process and wait until it disappears.
 * @param {number|string} pid
 * @param {string|{signal?: string, timeout?: number}} [opts] timeout in seconds
 * @param {Function} [cb]
 * @returns {Promise<string>} resolves with the pid
 */
export function kill(pid, opts, cb) {
  const callback = typeof opts === 'function' ? opts : cb;
  const { signal, timeout } = normalizeKillOpts(
    typeof opts === 'function' ? undefined : opts
  );
  const num = Number(pid);
  let promise;
  if (!hasValue(pid) || !Number.isInteger(num) || num <= 0) {
    promise = Promise.reject(new Error(`Invalid pid: ${pid}`));
  } else {
    try {
      process.kill(num, signal);
      promise = waitForExit(num, Number(timeout) * 1000);
    } catch (err) {
      promise = Promise.reject(err);
    }
  }
  return withCallback(promise, callback);
}

const ps = { lookup, lookupSync, tree, treeSync, kill };

export default ps;
