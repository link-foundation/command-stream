const PROCESS_CONTEXT_KEY = '_commandStreamProcessContext';

export function effectiveCwd(runner) {
  return runner._effectiveCwd ?? runner.options.cwd;
}

export function effectiveEnv(runner) {
  return runner._effectiveEnv ?? runner.options.env;
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
