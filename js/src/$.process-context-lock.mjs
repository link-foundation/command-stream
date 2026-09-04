import {
  hasShellEscapes,
  needsRealShell,
  parseShellCommand,
} from './shell-parser.mjs';

function hasShellOperators(command) {
  return (
    command.includes('&&') ||
    command.includes('||') ||
    command.includes('(') ||
    command.includes(';') ||
    command.includes('&') ||
    (command.includes('cd ') && command.includes('&&'))
  );
}

function parsedCommandContains(parsed, commandName) {
  if (!parsed) {
    return false;
  }
  if (parsed.type === 'simple') {
    return parsed.cmd === commandName;
  }
  if (parsed.type === 'subshell') {
    return parsedCommandContains(parsed.command, commandName);
  }
  return parsed.commands?.some((command) =>
    parsedCommandContains(command, commandName)
  );
}

function usesVirtualCd(runner) {
  if (
    runner.options._bypassVirtual ||
    typeof runner.spec.command !== 'string' ||
    hasShellEscapes(runner.spec.command)
  ) {
    return false;
  }

  const useShellOps =
    runner.options.shellOperators && hasShellOperators(runner.spec.command);
  if (useShellOps && needsRealShell(runner.spec.command)) {
    return false;
  }

  return parsedCommandContains(parseShellCommand(runner.spec.command), 'cd');
}

export function needsProcessContextLock(runner) {
  return (
    !runner.options._processContextLockHeld && runner.spec.mode !== 'pipeline'
  );
}

export async function runWithRunnerProcessContext(runner, operation) {
  const hadLockOption = Object.hasOwn(
    runner.options,
    '_processContextLockHeld'
  );
  const previousLockOption = runner.options._processContextLockHeld;
  runner.options._processContextLockHeld = true;

  try {
    return runner.spec.mode === 'shell' && usesVirtualCd(runner)
      ? await runner._runWithSerializedProcessContext(operation)
      : await runner._runWithSharedProcessContext(operation);
  } finally {
    if (hadLockOption) {
      runner.options._processContextLockHeld = previousLockOption;
    } else {
      delete runner.options._processContextLockHeld;
    }
  }
}
