import { resolvePreferredEnv } from './$.local-bin.mjs';

const PROCESS_CONTEXT_KEY = '_commandStreamProcessContext';

export function effectiveCwd(runner) {
  return runner._effectiveCwd ?? runner.options.cwd;
}

export function effectiveEnv(runner) {
  const { env, cwd, preferLocal } = runner.options;
  return runner._effectiveEnv ?? resolvePreferredEnv(env, cwd, preferLocal);
}

export function applyVirtualProcessContext(runner, result) {
  const context = result?.[PROCESS_CONTEXT_KEY];
  if (!context) {
    return result;
  }

  runner._effectiveCwd = context.cwd;
  runner._effectiveEnv = {
    ...(effectiveEnv(runner) ?? process.env),
    PWD: context.cwd,
    OLDPWD: context.oldpwd,
  };
  delete result[PROCESS_CONTEXT_KEY];
  return result;
}

export function withVirtualProcessContext(result, context) {
  return { ...result, [PROCESS_CONTEXT_KEY]: context };
}
