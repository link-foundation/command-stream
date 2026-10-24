// Which runtimes the examples can be executed with.
//
// The parity check and the documentation generator both need the same answer to
// "which runtimes are available here", so they ask this module.
import { execFileSync } from 'child_process';

const CANDIDATES = [
  {
    id: 'node',
    label: 'Node.js',
    command: process.execPath.includes('bun') ? 'node' : process.execPath,
    versionArgs: ['--version'],
  },
  { id: 'bun', label: 'Bun', command: 'bun', versionArgs: ['--version'] },
];

function probe(candidate) {
  try {
    const version = execFileSync(candidate.command, candidate.versionArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return {
      ...candidate,
      runArgs: [],
      version: version.trim().split('\n')[0].replace(/^v/, ''),
    };
  } catch {
    return null;
  }
}

// Returns the runtimes that are actually installed, in a stable order.
export function availableRuntimes() {
  return CANDIDATES.map(probe).filter(Boolean);
}

export function requireRuntimes(ids) {
  const available = availableRuntimes();
  const missing = ids.filter(
    (id) => !available.some((runtime) => runtime.id === id)
  );
  if (missing.length > 0) {
    throw new Error(`Required runtime(s) not installed: ${missing.join(', ')}`);
  }
  return available.filter((runtime) => ids.includes(runtime.id));
}
