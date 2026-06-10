import { $ } from '../js/src/$.mjs';
process.chdir('/tmp');
for (const cmd of ['echo $HOME', 'echo $PWD', 'echo $OLDPWD', 'echo ~']) {
  const r = await $`${{raw: cmd}}`.catch(e=>({stdout:'ERR '+e.message}));
  console.log(cmd, '->', JSON.stringify((r.stdout||'').toString().trim()));
}
