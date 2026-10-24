// A readiness marker must follow runner construction, which installs SIGINT.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const moduleUrl = new URL('../../js/src/$.mjs', import.meta.url).href;
for (const phase of ['before-construction', 'after-construction']) {
  const program = `
    import { $ } from ${JSON.stringify(moduleUrl)};
    let runner;
    if (${JSON.stringify(phase)} === 'after-construction') {
      runner = $\`sleep 2\`;
    }
    console.log('RUNTIME: NODE');
    // Force the parent to observe the marker before further startup work.
    await new Promise((resolve) => setTimeout(resolve, 250));
    runner ??= $\`sleep 2\`;
    await runner;
  `;
  const child = spawn('node', ['--input-type=module', '-e', program], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let sentSignal = false;
  child.stdout.on('data', (data) => {
    output += data.toString();
    if (!sentSignal && output.includes('RUNTIME: NODE')) {
      sentSignal = true;
      child.kill('SIGINT');
    }
  });
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(sentSignal, true, stderr);
    assert.deepEqual(
      result,
      phase === 'before-construction'
        ? { code: null, signal: 'SIGINT' }
        : { code: 130, signal: null }
    );
    console.log(`${phase}: ${JSON.stringify(result)}`);
  } finally {
    clearTimeout(watchdog);
  }
}
