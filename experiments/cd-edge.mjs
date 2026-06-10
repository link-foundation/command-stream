import { $ } from '../src/$.mjs';
process.chdir('/tmp');
async function t(cmd){ try{const r=await $`${{raw:cmd}}`; return `code=${r.code} out=${JSON.stringify((r.stdout||'').toString().trim())} err=${JSON.stringify((r.stderr||'').toString().trim())}`;}catch(e){return 'THROW '+e.message;}}
console.log('cd ~      ->', await t('cd ~'), 'cwd:', process.cwd());
process.chdir('/tmp');
console.log('cd        ->', await t('cd'), 'cwd:', process.cwd());
process.chdir('/tmp');
console.log('cd ~/     ->', await t('cd ~/'), 'cwd:', process.cwd());
