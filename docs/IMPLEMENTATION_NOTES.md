# Implementation Notes for Shell Operators Support

## Summary
The current implementation passes commands with `&&`, `||`, `;`, `()` to `sh -c`, which runs them in a subprocess. This prevents the virtual `cd` command from affecting the parent process directory.

## Solution
We've created a shell parser (`src/shell-parser.mjs`) that can parse these operators. Now we need to integrate it into `src/$.mjs` to execute parsed commands through our virtual command system.

## Required Changes in src/$.mjs

### 1. Import the parser
```javascript
import { parseShellCommand, needsRealShell } from './shell-parser.mjs';
```

### 2. Modify _doStartAsync method
Before checking for pipes, check if the command contains operators we can handle:

```javascript
async _doStartAsync() {
  // ... existing code ...
  
  // Check if command needs parsing for operators
  if (this.spec.mode === 'shell' && !needsRealShell(this.spec.command)) {
    const parsed = parseShellCommand(this.spec.command);
    if (parsed && parsed.type === 'sequence') {
      return await this._runSequence(parsed);
    } else if (parsed && parsed.type === 'subshell') {
      return await this._runSubshell(parsed);
    }
  }
  
  // ... continue with existing pipeline check ...
}
```

### 3. Add _runSequence method
```javascript
async _runSequence(sequence) {
  let lastResult = { code: 0, stdout: '', stderr: '' };
  let combinedStdout = '';
  let combinedStderr = '';
  
  for (let i = 0; i < sequence.commands.length; i++) {
    const command = sequence.commands[i];
    const operator = i > 0 ? sequence.operators[i - 1] : null;
    
    // Check operator conditions
    if (operator === '&&' && lastResult.code !== 0) continue;
    if (operator === '||' && lastResult.code === 0) continue;
    
    // Execute command
    if (command.type === 'subshell') {
      lastResult = await this._runSubshell(command);
    } else if (command.type === 'pipeline') {
      lastResult = await this._runPipeline(command.commands);
    } else if (command.type === 'simple') {
      lastResult = await this._runSimpleCommand(command);
    }
    
    combinedStdout += lastResult.stdout;
    combinedStderr += lastResult.stderr;
  }
  
  return {
    code: lastResult.code,
    stdout: combinedStdout,
    stderr: combinedStderr
  };
}
```

### 4. Add _runSubshell method
```javascript
async _runSubshell(subshell) {
  // Save current directory
  const savedCwd = process.cwd();
  
  try {
    // Execute subshell command
    const result = await this._runSequence(subshell.command);
    return result;
  } finally {
    // Restore directory
    process.chdir(savedCwd);
  }
}
```

### 5. Add _runSimpleCommand method
```javascript
async _runSimpleCommand(command) {
  const { cmd, args, redirects } = command;
  
  // Check for virtual command
  if (virtualCommandsEnabled && virtualCommands.has(cmd)) {
    const argValues = args.map(a => a.value);
    return await this._runVirtual(cmd, argValues);
  }
  
  // Fall back to real command execution
  // ... handle redirects if present ...
  
  return await this._executeRealCommand(cmd, args);
}
```

## Testing
After implementation:
1. `cd /tmp && pwd` should output `/tmp`
2. `cd /tmp` followed by `pwd` should output `/tmp`
3. `(cd /tmp && pwd) ; pwd` should output `/tmp` then original directory
4. All existing tests should still pass

## Benefits
1. Virtual commands work with shell operators
2. `cd` behaves exactly like shell cd
3. Better performance (no subprocess for simple operator chains)
4. Consistent behavior across platforms