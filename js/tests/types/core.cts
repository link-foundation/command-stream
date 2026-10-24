import $ = require('command-stream/core');

const runner: $.ProcessRunner = $({ mirror: false })`echo typed`;
const same: typeof $ = $.$;
const defaults: $.ProcessOptions = { mirror: false };
void [runner, same, defaults, $.ProcessRunner, $.sh('echo typed')];

// @ts-expect-error Compatibility APIs belong to the full entry.
$.bun`echo full`;
