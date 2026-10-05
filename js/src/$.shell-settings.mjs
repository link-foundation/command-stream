// Shell settings management (set, unset, shell object)
// Provides bash-like shell option management

import { trace } from './$.trace.mjs';
import { getShellSettings, setShellSettings } from './$.state.mjs';

/**
 * Set a shell option
 * @param {string} option - Option to set
 * @returns {object} Current shell settings
 */
export function set(option) {
  trace('API', () => `set() called with option: ${option}`);
  const mapping = {
    e: 'errexit', // set -e: exit on error
    errexit: 'errexit',
    v: 'verbose', // set -v: verbose
    verbose: 'verbose',
    x: 'xtrace', // set -x: trace execution
    xtrace: 'xtrace',
    u: 'nounset', // set -u: error on unset vars
    nounset: 'nounset',
    'o pipefail': 'pipefail', // set -o pipefail
    pipefail: 'pipefail',
  };

  const globalShellSettings = getShellSettings();

  if (mapping[option]) {
    setShellSettings({ [mapping[option]]: true });
    if (globalShellSettings.verbose) {
      console.log(`+ set -${option}`);
    }
  }
  return getShellSettings();
}

/**
 * Unset a shell option
 * @param {string} option - Option to unset
 * @returns {object} Current shell settings
 */
export function unset(option) {
  trace('API', () => `unset() called with option: ${option}`);
  const mapping = {
    e: 'errexit',
    errexit: 'errexit',
    v: 'verbose',
    verbose: 'verbose',
    x: 'xtrace',
    xtrace: 'xtrace',
    u: 'nounset',
    nounset: 'nounset',
    'o pipefail': 'pipefail',
    pipefail: 'pipefail',
  };

  const globalShellSettings = getShellSettings();

  if (mapping[option]) {
    setShellSettings({ [mapping[option]]: false });
    if (globalShellSettings.verbose) {
      console.log(`+ set +${option}`);
    }
  }
  return getShellSettings();
}

/**
 * Convenience object for common shell patterns
 */
export const shell = {
  set,
  unset,
  settings: () => ({ ...getShellSettings() }),

  // Bash-like shortcuts
  errexit: (enable = true) => (enable ? set('e') : unset('e')),
  verbose: (enable = true) => (enable ? set('v') : unset('v')),
  xtrace: (enable = true) => (enable ? set('x') : unset('x')),
  pipefail: (enable = true) =>
    enable ? set('o pipefail') : unset('o pipefail'),
  nounset: (enable = true) => (enable ? set('u') : unset('u')),
};
