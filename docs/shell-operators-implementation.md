# Shell Operators Implementation Plan

## Current State
- Commands with `&&`, `||`, `;`, `()` are passed to `sh -c` as a whole string
- This runs in a subprocess, so `cd` changes don't affect the parent process
- Virtual commands only work for simple commands and pipe chains

## Required Changes

### 1. Enhanced Command Parser
Need to parse these operators:
- `&&` - AND: execute next command only if previous succeeds (exit code 0)
- `||` - OR: execute next command only if previous fails (exit code != 0)
- `;` - SEMICOLON: execute next command regardless of previous result
- `()` - SUBSHELL: execute commands in a subshell (isolated environment)

### 2. Command Execution Flow
```javascript
// Current flow for "cd /tmp && ls"
1. Detect && operator
2. Pass entire string to sh -c "cd /tmp && ls"
3. Subprocess executes, cd affects only subprocess

// New flow
1. Parse: ["cd /tmp", "&&", "ls"]
2. Execute "cd /tmp" via virtual command (changes process.cwd)
3. If exit code == 0, execute "ls" 
4. Both commands see the changed directory
```

### 3. Subshell Handling
For `(cd /tmp && ls)`:
1. Save current process.cwd()
2. Execute commands inside ()
3. Restore original cwd after subshell completes

### 4. Parser Implementation
```javascript
function parseShellCommand(command) {
  // Parse operators while respecting:
  // - Quoted strings "..." and '...'
  // - Escaped characters
  // - Nested parentheses
  
  return {
    type: 'sequence',
    operators: ['&&', ';'],
    commands: [
      { type: 'simple', cmd: 'cd', args: ['/tmp'] },
      { type: 'simple', cmd: 'ls', args: [] }
    ]
  };
}
```

### 5. Execution Engine
```javascript
async function executeSequence(parsedCommand) {
  let lastExitCode = 0;
  
  for (let i = 0; i < parsedCommand.commands.length; i++) {
    const command = parsedCommand.commands[i];
    const operator = parsedCommand.operators[i-1];
    
    // Check operator conditions
    if (operator === '&&' && lastExitCode !== 0) continue;
    if (operator === '||' && lastExitCode === 0) continue;
    
    // Execute command
    const result = await executeCommand(command);
    lastExitCode = result.code;
  }
}
```

## Benefits
1. Virtual commands work in all contexts
2. `cd` behaves like real shell cd
3. Consistent behavior across platforms
4. Better control over execution flow

## Testing Requirements
1. Test all operators: `&&`, `||`, `;`
2. Test subshells: `()` 
3. Test nested subshells: `(cd /tmp && (cd /usr && pwd))`
4. Test with virtual and real commands mixed
5. Test error handling and exit codes