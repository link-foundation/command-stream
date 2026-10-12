const [chunks, bytes, delay] = process.argv.slice(2).map(Number);
if (
  !Number.isInteger(chunks) ||
  chunks < 1 ||
  chunks > 32 ||
  !Number.isInteger(bytes) ||
  bytes < 1 ||
  bytes > 262144 ||
  !Number.isInteger(delay) ||
  delay < 0 ||
  delay > 100
) {
  throw new Error(
    'bounded producer expects chunks=1..32, bytes=1..262144, delay=0..100'
  );
}
for (let index = 0; index < chunks; index++) {
  await new Promise((resolve, reject) =>
    process.stdout.write(Buffer.alloc(bytes, 120), (error) =>
      error ? reject(error) : resolve()
    )
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}
