/**
 * TypeScript definitions for type-safe pipeline operations in command-stream
 * Advanced pipeline composition with full type inference
 */

import { ProcessRunner, CommandResult, ProcessOptions } from '../index';

// Pipeline step types with full type inference
export type PipelineInput<T = Buffer> = T | AsyncIterable<T> | Promise<T>;
export type PipelineOutput<T = Buffer> = ProcessRunner | AsyncIterable<T> | Promise<T>;

export interface PipelineStep<TInput = any, TOutput = any> {
  (input: PipelineInput<TInput>): PipelineOutput<TOutput>;
}

// Type-safe pipeline builder with inference
export interface TypedPipeline<TInput = Buffer, TOutput = Buffer> {
  /** Add a processing step to the pipeline */
  pipe<TNext>(step: PipelineStep<TOutput, TNext>): TypedPipeline<TInput, TNext>;
  
  /** Add a command step to the pipeline */
  command(cmd: string, options?: ProcessOptions): TypedPipeline<TInput, Buffer>;
  
  /** Add a transformation step */
  transform<TNext>(
    transform: (input: TOutput) => TNext | Promise<TNext>
  ): TypedPipeline<TInput, TNext>;
  
  /** Add a filtering step */
  filter(predicate: (input: TOutput) => boolean | Promise<boolean>): TypedPipeline<TInput, TOutput>;
  
  /** Add a mapping step */
  map<TNext>(
    mapper: (input: TOutput) => TNext | Promise<TNext>
  ): TypedPipeline<TInput, TNext>;
  
  /** Execute the pipeline */
  execute(input: PipelineInput<TInput>): Promise<TOutput>;
  
  /** Execute and collect results as array */
  collect(input: PipelineInput<TInput>): Promise<TOutput[]>;
  
  /** Execute and get final result */
  result(input: PipelineInput<TInput>): Promise<CommandResult>;
}

// Pipeline creation functions with full type safety
export declare function pipeline<T = Buffer>(): TypedPipeline<T, T>;

export declare function pipeline<TInput, TOutput>(
  firstStep: PipelineStep<TInput, TOutput>
): TypedPipeline<TInput, TOutput>;

// Common pipeline patterns
export interface CommonPipelines {
  /** Text processing pipeline */
  text(): TypedPipeline<string, string>;
  
  /** JSON processing pipeline */
  json<T = any>(): TypedPipeline<T, T>;
  
  /** File processing pipeline */
  files(): TypedPipeline<string, Buffer>;
  
  /** Line-by-line processing pipeline */
  lines(): TypedPipeline<Buffer, string>;
  
  /** Byte processing pipeline */
  bytes(): TypedPipeline<Buffer, Buffer>;
}

export declare const pipelines: CommonPipelines;

// Pipeline composition utilities
export declare function compose<A, B, C>(
  f: PipelineStep<A, B>,
  g: PipelineStep<B, C>
): PipelineStep<A, C>;

export declare function compose<A, B, C, D>(
  f: PipelineStep<A, B>,
  g: PipelineStep<B, C>,
  h: PipelineStep<C, D>
): PipelineStep<A, D>;

// Overload for more compositions as needed
export declare function compose<T>(...steps: PipelineStep<any, any>[]): PipelineStep<any, T>;

// Parallel pipeline execution
export interface ParallelPipeline<TInput = Buffer, TOutput = Buffer> {
  /** Add a parallel branch */
  branch<TBranch>(
    step: PipelineStep<TInput, TBranch>
  ): ParallelPipeline<TInput, TOutput | TBranch>;
  
  /** Execute all branches in parallel */
  execute(input: PipelineInput<TInput>): Promise<TOutput[]>;
  
  /** Merge results from all branches */
  merge<TMerged>(
    merger: (results: TOutput[]) => TMerged | Promise<TMerged>
  ): Promise<TMerged>;
}

export declare function parallel<T = Buffer>(): ParallelPipeline<T, never>;

// Conditional pipeline execution
export interface ConditionalPipeline<TInput = Buffer> {
  /** Add a condition */
  when<TOutput>(
    condition: (input: TInput) => boolean | Promise<boolean>,
    step: PipelineStep<TInput, TOutput>
  ): ConditionalPipeline<TInput> & { then: TypedPipeline<TInput, TOutput> };
  
  /** Add an else branch */
  otherwise<TOutput>(
    step: PipelineStep<TInput, TOutput>
  ): TypedPipeline<TInput, TOutput>;
}

export declare function conditional<T = Buffer>(): ConditionalPipeline<T>;

// Pipeline error handling
export interface ErrorHandlingPipeline<TInput = Buffer, TOutput = Buffer> 
  extends TypedPipeline<TInput, TOutput> {
  
  /** Add error handling */
  catch<TError = Error>(
    handler: (error: TError, input: TInput) => TOutput | Promise<TOutput>
  ): ErrorHandlingPipeline<TInput, TOutput>;
  
  /** Add retry logic */
  retry(
    attempts: number,
    backoff?: (attempt: number) => number
  ): ErrorHandlingPipeline<TInput, TOutput>;
  
  /** Add fallback value */
  fallback(value: TOutput | (() => TOutput | Promise<TOutput>)): TypedPipeline<TInput, TOutput>;
}

export declare function resilient<TInput = Buffer, TOutput = Buffer>(
  pipeline: TypedPipeline<TInput, TOutput>
): ErrorHandlingPipeline<TInput, TOutput>;

// Pipeline monitoring and debugging
export interface PipelineMetrics {
  stepCount: number;
  totalDuration: number;
  stepDurations: number[];
  stepNames: string[];
  inputSize?: number;
  outputSize?: number;
  throughput?: number;
}

export interface MonitoredPipeline<TInput = Buffer, TOutput = Buffer> 
  extends TypedPipeline<TInput, TOutput> {
  
  /** Get execution metrics */
  getMetrics(): PipelineMetrics;
  
  /** Add step timing */
  timeStep(name: string): MonitoredPipeline<TInput, TOutput>;
  
  /** Add logging */
  log(logger: (step: string, input: any, output: any, duration: number) => void): MonitoredPipeline<TInput, TOutput>;
}

export declare function monitored<TInput = Buffer, TOutput = Buffer>(
  pipeline: TypedPipeline<TInput, TOutput>
): MonitoredPipeline<TInput, TOutput>;

// Common pipeline step factories
export interface PipelineSteps {
  /** Command execution step */
  command(cmd: string, options?: ProcessOptions): PipelineStep<Buffer, Buffer>;
  
  /** Text transformation step */
  textTransform(
    transform: (text: string) => string | Promise<string>
  ): PipelineStep<Buffer, Buffer>;
  
  /** JSON parsing step */
  parseJson<T = any>(): PipelineStep<Buffer, T>;
  
  /** JSON stringifying step */
  stringifyJson(): PipelineStep<any, Buffer>;
  
  /** File reading step */
  readFile(path: string): PipelineStep<void, Buffer>;
  
  /** File writing step */
  writeFile(path: string): PipelineStep<Buffer, void>;
  
  /** Buffer to string conversion */
  toString(encoding?: BufferEncoding): PipelineStep<Buffer, string>;
  
  /** String to buffer conversion */
  toBuffer(encoding?: BufferEncoding): PipelineStep<string, Buffer>;
  
  /** Array collection step */
  collect<T>(): PipelineStep<AsyncIterable<T>, T[]>;
  
  /** Batching step */
  batch<T>(size: number): PipelineStep<AsyncIterable<T>, AsyncIterable<T[]>>;
  
  /** Debouncing step */
  debounce<T>(delay: number): PipelineStep<AsyncIterable<T>, AsyncIterable<T>>;
  
  /** Throttling step */
  throttle<T>(rate: number): PipelineStep<AsyncIterable<T>, AsyncIterable<T>>;
}

export declare const steps: PipelineSteps;

// Template literal type for command pipelines
export type CommandTemplate = (strings: TemplateStringsArray, ...values: any[]) => ProcessRunner;

export interface PipelineTemplate {
  /** Template literal for type-safe command pipelines */
  (strings: TemplateStringsArray, ...values: any[]): TypedPipeline<Buffer, Buffer>;
}

export declare const p: PipelineTemplate;