// The CLI must provide a `require` bound to the script location.
import { strict as assert } from 'assert';

const data = require('../../../package.json');
assert.equal(data.name, 'command-stream');
assert.equal(data, require('command-stream/package.json'));
