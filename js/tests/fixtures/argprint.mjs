// Test fixture: print each received argv argument on its own line, wrapped in
// ARG[...] markers so tests can assert exact word-splitting. See issue #172.
for (const a of process.argv.slice(2)) {
  console.log(`ARG[${a}]`);
}
