/**
 * TypeScript Examples for command-stream
 * Demonstrates full type safety and IDE autocomplete support
 */

import $, { 
  ProcessRunner, 
  CommandResult, 
  register, 
  create, 
  quote, 
  raw,
  configureAnsi 
} from '../index';

// Example 1: Basic command execution with full typing
async function basicCommands(): Promise<void> {
  // Tagged template usage - returns ProcessRunner
  const result: CommandResult = await $`echo "Hello, TypeScript!"`;
  console.log(`Exit code: ${result.code}`); // number
  console.log(`Output: ${result.stdout}`);  // string
  
  // Command with interpolation - values are properly typed
  const name = "TypeScript";
  const greeting: CommandResult = await $`echo "Hello, ${name}!"`;
  console.log(await greeting.text()); // string
}

// Example 2: Options-based configuration with type safety
async function configuredCommands(): Promise<void> {
  // Using $ with options - returns a new tagged template function
  const quietCmd = $({ mirror: false, capture: true });
  const result: CommandResult = await quietCmd`pwd`;
  
  // Custom default options
  const customCmd = create({ 
    cwd: '/tmp', 
    env: { NODE_ENV: 'test' },
    interactive: false 
  });
  await customCmd`ls -la`;
}

// Example 3: Streaming with generic types
async function streamingExamples(): Promise<void> {
  const cmd: ProcessRunner = $`find . -name "*.ts"`;
  
  // Stream as buffers
  for await (const chunk of cmd.stream()) {
    // chunk is typed as Buffer
    console.log(`Received ${chunk.length} bytes`);
  }
  
  // Stream as lines
  const lineCmd: ProcessRunner = $`cat package.json`;
  for await (const line of lineCmd.lines()) {
    // line is typed as string
    console.log(`Line: ${line}`);
  }
}

// Example 4: Event-based processing with typed events
function eventDrivenProcessing(): void {
  const cmd: ProcessRunner = $`tail -f /var/log/system.log`;
  
  // Typed event listeners
  cmd.on('data', (chunk: Buffer) => {
    console.log(`Data: ${chunk.toString()}`);
  });
  
  cmd.on('end', (result: CommandResult) => {
    console.log(`Finished with code: ${result.code}`);
  });
  
  cmd.on('error', (error: Error) => {
    console.error(`Error: ${error.message}`);
  });
}

// Example 5: Virtual commands with type safety
async function virtualCommandsExample(): Promise<void> {
  // Register a typed virtual command
  register('greet', async (args: string[]): Promise<CommandResult> => {
    const name = args[0] || 'World';
    return {
      code: 0,
      stdout: `Hello, ${name}!`,
      stderr: '',
      stdin: '',
      async text() { return this.stdout; }
    };
  });
  
  // Use the virtual command
  const result: CommandResult = await $`greet TypeScript`;
  console.log(result.stdout); // "Hello, TypeScript!"
}

// Example 6: Advanced streaming transformations
async function advancedStreaming(): Promise<void> {
  const cmd: ProcessRunner = $`ls -la`;
  
  // Custom stream transformation with types
  const stream = cmd.stream({
    transform: (chunk: Buffer): string => chunk.toString().toUpperCase(),
    encoding: 'utf8'
  });
  
  for await (const transformedChunk of stream) {
    // transformedChunk is typed as string due to transform
    console.log(`Transformed: ${transformedChunk}`);
  }
}

// Example 7: Pipeline composition (conceptual - shows intended API)
async function pipelineExample(): Promise<void> {
  // Type-safe pipeline composition
  const result = await $`cat data.json`
    .then(r => r.stdout)
    .then(JSON.parse)
    .then((data: any[]) => data.filter(item => item.active))
    .then(filtered => JSON.stringify(filtered, null, 2));
  
  console.log(result);
}

// Example 8: Error handling with proper types
async function errorHandling(): Promise<void> {
  try {
    const result: CommandResult = await $`nonexistent-command`;
    console.log(result.stdout);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Command failed: ${error.message}`);
    }
  }
}

// Example 9: Working with process streams directly
async function processStreams(): Promise<void> {
  const cmd: ProcessRunner = $`grep -n "error" /var/log/system.log`;
  
  // Access typed streams
  const stdout = cmd.stdout; // Readable | null
  const stderr = cmd.stderr; // Readable | null
  const stdin = cmd.stdin;   // Writable | null
  
  if (stdout) {
    stdout.on('data', (chunk: Buffer) => {
      console.log(`Found error: ${chunk.toString()}`);
    });
  }
}

// Example 10: Utility functions with proper typing
function utilityExamples(): void {
  // Quote function with type safety
  const userInput = "file with spaces.txt";
  const quotedInput: string = quote(userInput);
  console.log(quotedInput); // 'file with spaces.txt'
  
  // Raw function for unescaped values
  const rawCommand = raw("echo hello | wc -w");
  console.log(`${rawCommand}`); // echo hello | wc -w
}

// Example 11: Configuration and ANSI handling
function configurationExample(): void {
  // Configure ANSI processing with typed options
  configureAnsi({
    enabled: true,
    colors: true,
    styles: false
  });
  
  // Global configuration
  import('./index').then(({ set, unset }) => {
    set('verbose'); // Enable verbose logging
    unset('mirror'); // Disable output mirroring
  });
}

// Example 12: Advanced async iteration patterns
async function asyncIterationPatterns(): Promise<void> {
  const cmd: ProcessRunner = $`ping -c 5 google.com`;
  
  // Collect all chunks
  const chunks: Buffer[] = [];
  for await (const chunk of cmd.stream()) {
    chunks.push(chunk);
  }
  
  // Process line by line with proper typing
  const lines: string[] = [];
  for await (const line of cmd.lines()) {
    lines.push(line);
  }
  
  console.log(`Collected ${chunks.length} chunks and ${lines.length} lines`);
}

// Example 13: Combining multiple commands with type safety
async function multipleCommands(): Promise<void> {
  // Sequential execution
  const ls: CommandResult = await $`ls`;
  const wc: CommandResult = await $`echo ${ls.stdout} | wc -l`;
  
  console.log(`Directory has ${wc.stdout.trim()} items`);
  
  // Parallel execution with proper typing
  const [date, uptime]: [CommandResult, CommandResult] = await Promise.all([
    $`date`,
    $`uptime`
  ]);
  
  console.log(`Current time: ${date.stdout.trim()}`);
  console.log(`System uptime: ${uptime.stdout.trim()}`);
}

// Example 14: Type-safe environment and working directory
async function environmentExample(): Promise<void> {
  // Custom environment with full typing
  const envCmd = $({ 
    env: { 
      NODE_ENV: 'production',
      DEBUG: 'command-stream:*' 
    },
    cwd: process.cwd()
  });
  
  const result: CommandResult = await envCmd`node --version`;
  console.log(`Node version: ${result.stdout.trim()}`);
}

// Export all examples for demonstration
export {
  basicCommands,
  configuredCommands,
  streamingExamples,
  eventDrivenProcessing,
  virtualCommandsExample,
  advancedStreaming,
  pipelineExample,
  errorHandling,
  processStreams,
  utilityExamples,
  configurationExample,
  asyncIterationPatterns,
  multipleCommands,
  environmentExample
};

// Main demonstration function
export async function runAllExamples(): Promise<void> {
  console.log('Running TypeScript examples for command-stream...');
  
  try {
    await basicCommands();
    await configuredCommands();
    await streamingExamples();
    eventDrivenProcessing();
    await virtualCommandsExample();
    await advancedStreaming();
    await pipelineExample();
    await errorHandling();
    await processStreams();
    utilityExamples();
    configurationExample();
    await asyncIterationPatterns();
    await multipleCommands();
    await environmentExample();
    
    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}