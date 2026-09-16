const $ = Bun.$;
const out = [];
const t = async (label, fn) => { try { out.push([label, 'ok', await fn()]); } catch (e) { out.push([label, 'ERR', String(e.message).split('\n')[0]]); } };

await t('text', async () => await $`echo hi`.text());
await t('quiet stdout', async () => (await $`echo hi`.quiet()).stdout.toString());
await t('nothrow code', async () => (await $`exit 3`.nothrow().quiet()).exitCode);
await t('json', async () => await $`echo '{"a":1}'`.json());
await t('lines', async () => { const l=[]; for await (const line of $`printf 'a\nb\n'`.lines()) l.push(line); return l; });
await t('cwd', async () => (await $`pwd`.cwd('/tmp').quiet()).stdout.toString().trim());
await t('env', async () => (await $`printenv X`.env({ X: 'y' }).quiet()).stdout.toString());
await t('stdin', async () => (await $`cat < ${new Response('x')}`.quiet()).stdout.toString());
await t('escape', () => $.escape("it's"));
await t('pipe builtin', async () => (await $`echo hi | tr a-z A-Z`.quiet()).stdout.toString());
await t('sync', () => String($`echo hi`.sync?.()) );
await t('register custom cmd', () => typeof $.Shell);
for (const [l, s, v] of out) console.log(s.padEnd(4), l.padEnd(20), JSON.stringify(v));
