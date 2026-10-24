// Execa supports async line iteration; native command-stream exposes typed
// chunks for stdout, stderr and exit status in the same loop.
import { $ } from '../src/$.mjs';
import { execa } from '../src/execa/index.mjs';

const script =
  'console.log("first"); setTimeout(() => console.log("second"), 50)';
for await (const line of execa(process.execPath, ['-e', script])) {
  console.log('Execa line:', line);
}
for await (const chunk of $({
  mirror: false,
})`${process.execPath} -e ${script}`.stream()) {
  console.log(
    'Native chunk:',
    chunk.type === 'exit' ? chunk.code : `${chunk.type}: ${chunk.data}`
  );
}
