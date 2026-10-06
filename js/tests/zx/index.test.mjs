// Port of zx test/index.test.js (issue #26). Test vectors come from google/zx
// (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  bus,
  nothrow,
  quiet,
  versions,
  version,
  VERSION,
  $,
  log,
  cd,
  syncProcessCwd,
  usePowerShell,
  usePwsh,
  useBash,
  kill,
  ProcessOutput,
  ProcessPromise,
  defaults,
  dotenv,
  minimist,
  chalk,
  fs,
  which,
  YAML,
  ps,
  quote,
  quotePowerShell,
  within,
  os,
  argv,
  parseArgv,
  updateArgv,
  globby,
  glob,
  sleep,
  fetch,
  echo,
  question,
  stdin,
  retry,
  expBackoff,
  spinner,
  path,
  tempdir,
  tempfile,
  tmpdir,
  tmpfile,
} from '../../src/zx/index.mjs';

describe('index', () => {
  test('[zx:test/index.test.js:67:3:registration] has proper exports', () => {
    // index
    assert(nothrow);
    assert(quiet);
    assert(version);
    assert(versions);
    assert.equal(version, VERSION);

    // core
    assert($);
    assert(ProcessOutput);
    assert(ProcessPromise);
    assert(cd);
    assert(syncProcessCwd);
    assert(log);
    assert(kill);
    assert(defaults);
    assert(within);
    assert(usePowerShell);
    assert(usePwsh);
    assert(useBash);

    // goods
    assert(os);
    assert(argv);
    assert(parseArgv);
    assert(updateArgv);
    assert(globby);
    assert(glob);
    assert(sleep);
    assert(fetch);
    assert(echo);
    assert(question);
    assert(stdin);
    assert(retry);
    assert(expBackoff);
    assert(spinner);
    assert(path);

    // vendor
    assert(minimist);
    assert(chalk);
    assert(fs);
    assert(which);
    assert(YAML);
    assert(ps);
    assert(dotenv);

    // utils
    assert(quote);
    assert(quotePowerShell);
    assert(tempdir);
    assert(tmpdir);
    assert(tmpfile);
    assert(tempfile);
  });

  test('[zx:test/index.test.js:124:3:registration] bus is locked', () => {
    assert.throws(() => bus.wrap('test', () => {}), /locked/);
  });
});
