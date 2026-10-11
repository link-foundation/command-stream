import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.EVCXR_CONFIG_DIR;
console.log(
  JSON.stringify({
    directory,
    init: readFileSync(join(directory, 'init.evcxr'), 'utf8'),
    prelude: readFileSync(join(directory, 'prelude.rs'), 'utf8'),
    manifest: readFileSync(join(directory, 'facade', 'Cargo.toml'), 'utf8'),
    facade: readFileSync(join(directory, 'facade', 'lib.rs'), 'utf8'),
  })
);
if (process.argv.includes('--hold')) {
  process.on('SIGTERM', () => {});
  // Finite even if the lifecycle test fails to stop it.
  setTimeout(() => process.exit(0), 30000);
}
