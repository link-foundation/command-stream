/**
 * Advanced TypeScript Features for command-stream
 * Demonstrates unique type features that competitors don't have
 */

import { 
  ProcessRunner,
  CommandResult,
  register,
  VirtualCommandHandler,
  StreamingOptions,
  PipelineStep,
  Pipeline
} from '../index';

// Advanced type definitions for unique features
type VirtualCommandRegistry = Map<string, VirtualCommandHandler>;
type StreamTransform<T, U> = (input: T) => U | Promise<U>;
type EventMap = Record<string, any[]>;

// Example 1: Type-safe virtual command registration with advanced generics
interface TypedVirtualCommand<TArgs extends readonly unknown[], TReturn> {
  name: string;
  description?: string;
  handler: (...args: TArgs) => Promise<TReturn> | TReturn;
}

// Register a math virtual command with full type safety
const mathCommand: TypedVirtualCommand<[number, string, number], CommandResult> = {
  name: 'math',
  description: 'Perform mathematical operations',
  handler: async (a: number, op: string, b: number): Promise<CommandResult> => {
    let result: number;
    switch (op) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': result = a * b; break;
      case '/': result = a / b; break;
      default: throw new Error(`Unknown operation: ${op}`);
    }
    
    return {
      code: 0,
      stdout: result.toString(),
      stderr: '',
      stdin: '',
      async text() { return this.stdout; }
    };
  }
};

// Example 2: Advanced streaming with generic type transformations
interface StreamProcessor<TInput, TOutput> {
  transform: StreamTransform<TInput, TOutput>;
  filter?: (item: TInput) => boolean | Promise<boolean>;
  batch?: number;
}

async function advancedStreamProcessing<T, U>(
  runner: ProcessRunner,
  processor: StreamProcessor<T, U>
): Promise<U[]> {
  const results: U[] = [];
  let batch: T[] = [];
  
  for await (const chunk of runner.stream()) {
    const item = chunk as unknown as T;
    
    // Apply filter if provided
    if (processor.filter && !(await processor.filter(item))) {
      continue;
    }
    
    // Handle batching
    if (processor.batch) {
      batch.push(item);
      if (batch.length >= processor.batch) {
        const transformed = await Promise.all(
          batch.map(processor.transform)
        );
        results.push(...transformed);
        batch = [];
      }
    } else {
      const transformed = await processor.transform(item);
      results.push(transformed);
    }
  }
  
  // Process remaining batch
  if (batch.length > 0) {
    const transformed = await Promise.all(
      batch.map(processor.transform)
    );
    results.push(...transformed);
  }
  
  return results;
}

// Example 3: Type-safe pipeline builder with inference
class TypeSafePipeline<TInput, TOutput> {
  private steps: PipelineStep<any, any>[] = [];
  
  constructor(private initialType: new() => TInput) {}
  
  pipe<TNext>(
    step: PipelineStep<TOutput, TNext>
  ): TypeSafePipeline<TInput, TNext> {
    this.steps.push(step);
    return this as any;
  }
  
  map<TNext>(
    transform: (input: TOutput) => TNext | Promise<TNext>
  ): TypeSafePipeline<TInput, TNext> {
    this.steps.push(async (input: TOutput) => transform(input));
    return this as any;
  }
  
  filter(
    predicate: (input: TOutput) => boolean | Promise<boolean>
  ): TypeSafePipeline<TInput, TOutput> {
    this.steps.push(async function* (input: AsyncIterable<TOutput>) {
      for await (const item of input) {
        if (await predicate(item)) {
          yield item;
        }
      }
    });
    return this;
  }
  
  async execute(input: TInput): Promise<TOutput> {
    let current: any = input;
    for (const step of this.steps) {
      current = await step(current);
    }
    return current;
  }
}

// Example 4: Advanced event system with discriminated unions
type CommandEvent = 
  | { type: 'start'; timestamp: Date; command: string }
  | { type: 'data'; chunk: Buffer; size: number }
  | { type: 'line'; content: string; lineNumber: number }
  | { type: 'end'; result: CommandResult; duration: number }
  | { type: 'error'; error: Error; context: string };

interface TypedEventEmitter<TEvents extends EventMap> {
  on<K extends keyof TEvents>(
    event: K,
    listener: (...args: TEvents[K]) => void
  ): this;
  
  emit<K extends keyof TEvents>(
    event: K,
    ...args: TEvents[K]
  ): boolean;
}

// Example 5: Conditional type system for command validation
type ValidCommand<T> = T extends `${string}${infer Rest}` 
  ? Rest extends ` ${string}` | ''
    ? T 
    : never
  : never;

type SafeCommand = ValidCommand<'echo hello'> | ValidCommand<'ls -la'> | ValidCommand<'pwd'>;

// Example 6: Advanced streaming interface with backpressure
interface BackpressureStream<T> {
  readonly readable: boolean;
  readonly highWaterMark: number;
  readonly objectMode: boolean;
  
  read(size?: number): T | null;
  on(event: 'readable', listener: () => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

// Example 7: Sophisticated error handling with typed error contexts
class CommandError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly command: string,
    public readonly stderr: string,
    public readonly context: 'execution' | 'streaming' | 'virtual-command'
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

interface ErrorRecoveryStrategy<T> {
  retries: number;
  backoff: (attempt: number) => number;
  fallback?: () => Promise<T>;
  shouldRetry: (error: Error) => boolean;
}

async function executeWithRecovery<T>(
  operation: () => Promise<T>,
  strategy: ErrorRecoveryStrategy<T>
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= strategy.retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (!strategy.shouldRetry(error as Error) || attempt === strategy.retries) {
        break;
      }
      
      const delay = strategy.backoff(attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  if (strategy.fallback) {
    return strategy.fallback();
  }
  
  throw lastError!;
}

// Example 8: Real-world usage combining all features
export async function demonstrateAdvancedFeatures(): Promise<void> {
  // Register the typed math command
  register('math', mathCommand.handler);
  
  // Create a type-safe pipeline for log processing
  const logPipeline = new TypeSafePipeline(Buffer)
    .map((buffer: Buffer) => buffer.toString())
    .filter((line: string) => line.includes('ERROR'))
    .map((line: string) => ({
      timestamp: new Date(),
      level: 'ERROR',
      message: line.trim()
    }));
  
  // Use advanced streaming with error recovery
  const strategy: ErrorRecoveryStrategy<CommandResult> = {
    retries: 3,
    backoff: (attempt) => Math.pow(2, attempt) * 1000,
    shouldRetry: (error) => error.message.includes('temporary'),
    fallback: async () => ({
      code: -1,
      stdout: '',
      stderr: 'Operation failed after retries',
      stdin: '',
      async text() { return this.stderr; }
    })
  };
  
  try {
    // Execute commands with full type safety and error handling
    const result = await executeWithRecovery(
      async () => {
        const mathResult = await import('../index').then(({ $ }) => $`math 10 + 5`);
        return mathResult;
      },
      strategy
    );
    
    console.log(`Math result: ${result.stdout}`);
    
  } catch (error) {
    if (error instanceof CommandError) {
      console.error(`Command failed in ${error.context}: ${error.message}`);
    }
  }
}

// Example 9: Template literal types for command validation
type CommandTemplate<T extends string> = T extends `${infer Command} ${infer Args}`
  ? { command: Command; args: Args }
  : { command: T; args: '' };

function parseCommand<T extends string>(cmd: T): CommandTemplate<T> {
  const parts = cmd.split(' ', 2);
  return {
    command: parts[0],
    args: parts.slice(1).join(' ')
  } as CommandTemplate<T>;
}

// Example 10: Advanced type guards and narrowing
function isStreamableResult(result: any): result is AsyncIterable<Buffer> {
  return result && typeof result[Symbol.asyncIterator] === 'function';
}

function isCommandResult(result: any): result is CommandResult {
  return result && 
    typeof result.code === 'number' &&
    typeof result.stdout === 'string' &&
    typeof result.stderr === 'string';
}

// Export the demonstration
export { 
  mathCommand,
  advancedStreamProcessing,
  TypeSafePipeline,
  CommandError,
  executeWithRecovery,
  parseCommand,
  isStreamableResult,
  isCommandResult
};