// The CLI must provide CommonJS-style __filename/__dirname to ESM scripts.
import { strict } from 'assert';
/* global path */

strict.equal(path.basename(__filename), 'filename-dirname.mjs');
strict.equal(path.basename(__dirname), 'fixtures');
