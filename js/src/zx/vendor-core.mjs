// Helpers the zx core depends on, exposed through the override bus.

import _chalk from './vendor/chalk.mjs';
import _which from './vendor/which.mjs';
import _ps from './vendor/ps.mjs';
import { bus } from './internals.mjs';

export const chalk = bus.wrap('chalk', _chalk);
export const which = bus.wrap('which', _which);
export const ps = bus.wrap('ps', _ps);
