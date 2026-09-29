// Dev-only resolve hook: while vendor/yaml.mjs and vendor/maml.mjs are being
// written, resolve them to an empty stub so the rest of the zx port loads.
import { register } from 'node:module';
register(
  `data:text/javascript,${encodeURIComponent(`
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx).catch((e) => {
    if (/vendor\\/(yaml|maml)\\.mjs$/.test(spec)) return { url: 'data:text/javascript,export default {parse(){},stringify(){}}', shortCircuit: true };
    throw e;
  });
  return r;
}`)}`
);
