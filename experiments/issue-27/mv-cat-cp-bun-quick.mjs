// Quick Bun probe: run raw shell commands in a fixture dir and print results.
// Usage: BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS=1 bun mv-cat-cp-bun-quick.mjs <dir> 'cmd' ...
const [dir, ...cmds] = process.argv.slice(2);
for (const c of cmds) {
  const res = await Bun.$`${{ raw: c }}`.cwd(dir).nothrow().quiet();
  console.log(
    JSON.stringify(c),
    res.exitCode,
    JSON.stringify(res.stdout.toString()),
    JSON.stringify(res.stderr.toString())
  );
}
