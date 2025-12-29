import { $ } from '../js/src/$.mjs';

async function test() {
  console.log('Starting test...');
  const startTime = Date.now();
  let firstChunkTime = null;

  const cmd = $`echo "immediate"; sleep 0.1; echo "delayed"`;
  console.log('Command created');

  for await (const chunk of cmd.stream()) {
    console.log('Got chunk:', chunk.type, `${Date.now() - startTime}ms`);
    if (chunk.type === 'stdout' && firstChunkTime === null) {
      firstChunkTime = Date.now();
      console.log(
        'First chunk received after',
        firstChunkTime - startTime,
        'ms'
      );
      break;
    }
  }

  console.log('Test done');
}

test().catch(console.error);
