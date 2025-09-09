import { createInterface } from 'readline';
import { $ } from './$.mjs';
import { register } from './$.mjs';

const REPL_PROMPT = '> ';
const CONTINUATION_PROMPT = '... ';

export async function repl(options = {}) {
  console.log('command-stream REPL v0.7.1');
  console.log('Interactive shell environment with $ command support');
  console.log('Type "help" for commands, "exit" or Ctrl+C to quit\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: REPL_PROMPT,
    completer: autoComplete
  });

  let multilineBuffer = '';
  let inMultilineMode = false;

  // REPL-specific commands
  const replCommands = {
    help: () => {
      console.log(`
Available commands:
  help                  Show this help message
  exit                  Exit the REPL
  clear                 Clear the screen
  .commands             List all registered virtual commands
  .register <name> <fn> Register a new virtual command
  .unregister <name>    Unregister a virtual command

Shell features:
  $\`command\`           Execute shell command with streaming
  await $\`command\`     Wait for command to complete
  $.register(name, fn)  Register virtual command
  
Examples:
  > $\`ls -la\`
  > await $\`git status\`
  > const result = await $\`echo "hello"\`
  > result.stdout
`);
    },
    
    exit: () => {
      console.log('Goodbye!');
      rl.close();
      process.exit(0);
    },
    
    clear: () => {
      console.clear();
      console.log('command-stream REPL v0.7.1\n');
    },
    
    '.commands': async () => {
      const { listCommands } = await import('./$.mjs');
      const commands = listCommands();
      console.log('Registered virtual commands:', commands.join(', '));
    }
  };

  // Auto-completion support
  function autoComplete(line) {
    const completions = [
      // REPL commands
      'help', 'exit', 'clear', '.commands', '.register', '.unregister',
      // Common shell commands
      'ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'find', 'git', 'npm', 'node',
      // $ syntax
      '$`', 'await $`',
      // JavaScript keywords
      'const', 'let', 'var', 'function', 'async', 'await', 'for', 'if', 'else'
    ];
    
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  }

  // Handle line input
  rl.on('line', async (input) => {
    const trimmedInput = input.trim();
    
    // Handle empty input
    if (!trimmedInput) {
      rl.prompt();
      return;
    }
    
    // Handle multiline input
    if (inMultilineMode) {
      multilineBuffer += '\n' + input;
      
      // Check if multiline input is complete
      if (isCompleteStatement(multilineBuffer)) {
        await executeStatement(multilineBuffer);
        multilineBuffer = '';
        inMultilineMode = false;
        rl.setPrompt(REPL_PROMPT);
      } else {
        rl.setPrompt(CONTINUATION_PROMPT);
      }
      rl.prompt();
      return;
    }
    
    // Check for REPL commands
    if (replCommands[trimmedInput]) {
      await replCommands[trimmedInput]();
      rl.prompt();
      return;
    }
    
    // Check if statement is complete
    if (!isCompleteStatement(trimmedInput)) {
      multilineBuffer = trimmedInput;
      inMultilineMode = true;
      rl.setPrompt(CONTINUATION_PROMPT);
      rl.prompt();
      return;
    }
    
    await executeStatement(trimmedInput);
    rl.prompt();
  });

  // Handle SIGINT (Ctrl+C)
  rl.on('SIGINT', () => {
    if (inMultilineMode) {
      console.log('\n(Multiline input cancelled)');
      multilineBuffer = '';
      inMultilineMode = false;
      rl.setPrompt(REPL_PROMPT);
      rl.prompt();
    } else {
      console.log('\nUse "exit" or Ctrl+D to quit');
      rl.prompt();
    }
  });

  // Handle EOF (Ctrl+D)
  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  // Start the REPL
  rl.prompt();

  // Keep the REPL running
  return new Promise(() => {}); // Never resolves, REPL runs until exit
}

function isCompleteStatement(statement) {
  try {
    // Simple heuristic: check for unmatched brackets/braces
    let braceCount = 0;
    let bracketCount = 0;
    let parenCount = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    let templateDepth = 0;
    
    for (let i = 0; i < statement.length; i++) {
      const char = statement[i];
      const prevChar = i > 0 ? statement[i - 1] : '';
      
      // Handle string literals
      if (!inTemplate && (char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
        continue;
      }
      
      if (inString && !inTemplate) continue;
      
      // Handle template literals
      if (char === '`' && prevChar !== '\\') {
        if (!inTemplate) {
          inTemplate = true;
          templateDepth = 1;
        } else {
          templateDepth--;
          if (templateDepth === 0) {
            inTemplate = false;
          }
        }
        continue;
      }
      
      if (inTemplate && char === '`') {
        templateDepth++;
        continue;
      }
      
      if (inTemplate) continue;
      
      // Count brackets
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
      else if (char === '(') parenCount++;
      else if (char === ')') parenCount--;
    }
    
    // Statement is complete if all brackets are matched
    return braceCount === 0 && bracketCount === 0 && parenCount === 0 && !inString && !inTemplate;
  } catch (e) {
    // If we can't parse it, assume it's incomplete
    return false;
  }
}

async function executeStatement(statement) {
  try {
    // Create a sandboxed evaluation context with $ available
    const context = {
      $,
      console,
      process,
      require,
      __dirname: process.cwd(),
      __filename: 'repl'
    };
    
    // Wrap in async function to handle await
    const wrappedStatement = `
      return (async () => {
        ${statement}
      })();
    `;
    
    // Create function with context
    const contextKeys = Object.keys(context);
    const contextValues = Object.values(context);
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const func = new AsyncFunction(...contextKeys, wrappedStatement);
    
    // Execute with context
    const result = await func(...contextValues);
    
    // Display result if not undefined
    if (result !== undefined) {
      if (result && typeof result === 'object') {
        // Pretty print objects
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result);
      }
    }
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (process.env.COMMAND_STREAM_VERBOSE === 'true') {
      console.error(error.stack);
    }
  }
}