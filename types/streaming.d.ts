/**
 * TypeScript definitions for streaming functionality in command-stream
 * Advanced streaming interfaces with full generic type support
 */

import { Readable, Writable, Transform } from 'stream';
import { ProcessRunner, CommandResult } from '../index';

// Generic streaming transformations
export type StreamTransform<TInput = Buffer, TOutput = Buffer> = 
  (chunk: TInput) => TOutput | Promise<TOutput>;

export type StreamFilter<T = Buffer> = 
  (chunk: T) => boolean | Promise<boolean>;

export type StreamReducer<T = Buffer, TAcc = T> = 
  (accumulator: TAcc, chunk: T) => TAcc | Promise<TAcc>;

// Streaming options with generics
export interface StreamingOptions<TInput = Buffer, TOutput = TInput> {
  /** Transform each chunk */
  transform?: StreamTransform<TInput, TOutput>;
  /** Filter chunks */
  filter?: StreamFilter<TInput>;
  /** Encoding for string conversion */
  encoding?: BufferEncoding;
  /** Chunk size for reading */
  highWaterMark?: number;
  /** Object mode for non-buffer data */
  objectMode?: boolean;
}

// Line-based streaming
export interface LineStreamingOptions {
  /** Line ending character(s) */
  separator?: string | RegExp;
  /** Skip empty lines */
  skipEmpty?: boolean;
  /** Trim whitespace from lines */
  trim?: boolean;
  /** Encoding for string conversion */
  encoding?: BufferEncoding;
}

// Advanced streaming interfaces
export interface EnhancedProcessRunner extends ProcessRunner {
  // Generic streaming with transformations
  stream<TOutput = Buffer>(options?: StreamingOptions<Buffer, TOutput>): AsyncIterable<TOutput>;
  
  // JSON streaming (for commands that output JSON)
  json<T = any>(): AsyncIterable<T>;
  
  // Byte streaming with exact control
  bytes(options?: { chunkSize?: number }): AsyncIterable<Buffer>;
  
  // Text streaming with encoding
  text(encoding?: BufferEncoding): AsyncIterable<string>;
  
  // Stream operations
  map<TOutput>(transform: StreamTransform<Buffer, TOutput>): AsyncIterable<TOutput>;
  filter(predicate: StreamFilter<Buffer>): AsyncIterable<Buffer>;
  reduce<TAcc>(reducer: StreamReducer<Buffer, TAcc>, initialValue: TAcc): Promise<TAcc>;
  collect(): Promise<Buffer[]>;
  collectText(encoding?: BufferEncoding): Promise<string>;
  
  // Pipeline operations
  pipe<TTarget extends Writable>(destination: TTarget): TTarget;
  pipeThrough<TTransform extends Transform>(transform: TTransform): TTransform;
}

// Stream composition types
export type StreamPipeline<TInput = Buffer, TOutput = Buffer> = 
  (input: AsyncIterable<TInput>) => AsyncIterable<TOutput>;

export interface PipelineBuilder<T = Buffer> {
  map<TOutput>(transform: StreamTransform<T, TOutput>): PipelineBuilder<TOutput>;
  filter(predicate: StreamFilter<T>): PipelineBuilder<T>;
  take(count: number): PipelineBuilder<T>;
  skip(count: number): PipelineBuilder<T>;
  batch(size: number): PipelineBuilder<T[]>;
  build(): StreamPipeline<Buffer, T>;
}

// Stream utilities
export declare function createPipeline<T = Buffer>(): PipelineBuilder<T>;

export declare function streamToArray<T>(stream: AsyncIterable<T>): Promise<T[]>;

export declare function streamToString(
  stream: AsyncIterable<Buffer>, 
  encoding?: BufferEncoding
): Promise<string>;

export declare function mergeStreams<T>(...streams: AsyncIterable<T>[]): AsyncIterable<T>;

export declare function splitStream<T>(
  stream: AsyncIterable<T>,
  predicate: StreamFilter<T>
): [AsyncIterable<T>, AsyncIterable<T>];

// Real-time streaming events
export interface StreamEventMap<T = Buffer> {
  'chunk': T;
  'line': string;
  'json': any;
  'error': Error;
  'end': void;
  'start': void;
}

export interface RealTimeStream<T = Buffer> {
  on<K extends keyof StreamEventMap<T>>(
    event: K, 
    listener: (data: StreamEventMap<T>[K]) => void
  ): this;
  
  off<K extends keyof StreamEventMap<T>>(
    event: K, 
    listener: (data: StreamEventMap<T>[K]) => void
  ): this;
  
  once<K extends keyof StreamEventMap<T>>(
    event: K, 
    listener: (data: StreamEventMap<T>[K]) => void
  ): this;
}

// Streaming process runner factory
export declare function createStreamingRunner(
  command: string,
  options?: StreamingOptions
): EnhancedProcessRunner;

// Type guards
export declare function isStreamableProcessRunner(
  runner: ProcessRunner
): runner is EnhancedProcessRunner;

// Stream performance monitoring
export interface StreamMetrics {
  bytesProcessed: number;
  chunksProcessed: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  throughput?: number; // bytes per second
}

export declare function monitorStream<T>(
  stream: AsyncIterable<T>
): AsyncIterable<T> & { getMetrics(): StreamMetrics };

// Advanced stream combinators
export declare function race<T>(...streams: AsyncIterable<T>[]): AsyncIterable<T>;
export declare function parallel<T>(
  stream: AsyncIterable<T>,
  concurrency?: number
): AsyncIterable<T>;
export declare function buffer<T>(
  stream: AsyncIterable<T>,
  size: number
): AsyncIterable<T[]>;