/**
 * TypeScript definitions for virtual commands in command-stream
 * Built-in command implementations with full type safety
 */

import { CommandResult, ProcessOptions } from '../index';

// Built-in virtual commands with typed interfaces
export interface BuiltinCommands {
  // File system operations
  cat: (files: string[]) => Promise<CommandResult>;
  cp: (source: string, destination: string, options?: { recursive?: boolean }) => Promise<CommandResult>;
  mv: (source: string, destination: string) => Promise<CommandResult>;
  rm: (files: string[], options?: { recursive?: boolean; force?: boolean }) => Promise<CommandResult>;
  ls: (paths?: string[], options?: { all?: boolean; long?: boolean }) => Promise<CommandResult>;
  mkdir: (paths: string[], options?: { parents?: boolean; mode?: string }) => Promise<CommandResult>;
  touch: (files: string[]) => Promise<CommandResult>;
  pwd: () => Promise<CommandResult>;
  cd: (path?: string) => Promise<CommandResult>;
  
  // Text processing
  echo: (...args: string[]) => Promise<CommandResult>;
  yes: (text?: string) => AsyncIterable<Buffer>;
  seq: (start: number, end?: number, step?: number) => Promise<CommandResult>;
  
  // System utilities
  basename: (path: string, suffix?: string) => Promise<CommandResult>;
  dirname: (path: string) => Promise<CommandResult>;
  env: (variables?: Record<string, string>) => Promise<CommandResult>;
  which: (command: string) => Promise<CommandResult>;
  test: (expression: string) => Promise<CommandResult>;
  sleep: (seconds: number) => Promise<CommandResult>;
  
  // Control flow
  true: () => Promise<CommandResult>;
  false: () => Promise<CommandResult>;
  exit: (code?: number) => Promise<CommandResult>;
}

// Type-safe virtual command registration
export type VirtualCommandName = keyof BuiltinCommands;

export interface VirtualCommandDefinition<TArgs extends readonly unknown[] = unknown[]> {
  name: string;
  description?: string;
  usage?: string;
  handler: (...args: TArgs) => Promise<CommandResult> | CommandResult | AsyncIterable<Buffer>;
}

// Enhanced registration with full typing
export declare function registerVirtualCommand<TArgs extends readonly unknown[]>(
  definition: VirtualCommandDefinition<TArgs>
): void;

// Command existence checking
export declare function hasVirtualCommand(name: string): boolean;
export declare function getVirtualCommand(name: string): VirtualCommandDefinition | undefined;

// Bulk operations
export declare function registerBuiltinCommands(): void;
export declare function unregisterAllVirtualCommands(): void;

// Command metadata
export interface CommandMetadata {
  name: string;
  description: string;
  usage: string;
  category: 'filesystem' | 'text' | 'system' | 'control' | 'custom';
  builtin: boolean;
}

export declare function getCommandMetadata(name: string): CommandMetadata | undefined;
export declare function listCommandMetadata(): CommandMetadata[];