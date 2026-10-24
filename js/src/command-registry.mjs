import { virtualCommands } from './$.state.mjs';

export const commandMetadata = new Map();

export function validate(name, handler) {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z_][\w:.-]*$/.test(name) ||
    typeof handler !== 'function'
  ) {
    throw new TypeError(`Invalid virtual command: ${name}`);
  }
}

export function createCommand(name, handler, metadata = {}) {
  validate(name, handler);
  virtualCommands.set(name, handler);
  commandMetadata.set(name, { name, ...metadata });
  return handler;
}

export function extend(name, middleware) {
  const parent = virtualCommands.get(name);
  if (!parent) {
    throw new Error(`Virtual command not found: ${name}`);
  }
  if (typeof middleware !== 'function') {
    throw new TypeError('Middleware must be a function');
  }
  const handler = (context) =>
    middleware(context, (nextContext = context) => parent(nextContext));
  virtualCommands.set(name, handler);
  return handler;
}

export function inherit(name, parent, defaults = {}) {
  const handler = virtualCommands.get(parent);
  if (!handler) {
    throw new Error(`Virtual command not found: ${parent}`);
  }
  return createCommand(
    name,
    (context) =>
      handler({
        ...context,
        ...defaults,
        args: [...(defaults.args ?? []), ...context.args],
      }),
    { parent }
  );
}

async function collectResult(value) {
  value = await value;
  if (value?.[Symbol.asyncIterator] || value?.[Symbol.iterator]) {
    const chunks = [];
    for await (const chunk of value) {
      chunks.push(Buffer.from(chunk));
    }
    return { code: 0, stdout: Buffer.concat(chunks).toString() };
  }
  return { code: 0, stdout: '', ...value };
}

export function compose(...handlers) {
  if (
    !handlers.length ||
    handlers.some((handler) => typeof handler !== 'function')
  ) {
    throw new TypeError('Composition requires command handlers');
  }
  return async (context) => {
    let result = { code: 0, stdout: context.stdin ?? '' };
    for (const handler of handlers) {
      result = await collectResult(
        handler({ ...context, stdin: result.stdout })
      );
      if (result.code !== 0) {
        break;
      }
    }
    return result;
  };
}
