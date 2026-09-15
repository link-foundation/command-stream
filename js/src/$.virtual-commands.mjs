// Virtual commands registration and management
// Handles registration of built-in and custom virtual commands

import { trace } from './$.trace.mjs';
import { virtualCommands, getShellSettings } from './$.state.mjs';

// Import virtual command implementations
import cdCommand from './commands/$.cd.mjs';
import pwdCommand from './commands/$.pwd.mjs';
import echoCommand from './commands/$.echo.mjs';
import sleepCommand from './commands/$.sleep.mjs';
import trueCommand from './commands/$.true.mjs';
import falseCommand from './commands/$.false.mjs';
import createWhichCommand from './commands/$.which.mjs';
import createExitCommand from './commands/$.exit.mjs';
import envCommand from './commands/$.env.mjs';
import catCommand from './commands/$.cat.mjs';
import lsCommand from './commands/$.ls.mjs';
import mkdirCommand from './commands/$.mkdir.mjs';
import rmCommand from './commands/$.rm.mjs';
import mvCommand from './commands/$.mv.mjs';
import cpCommand from './commands/$.cp.mjs';
import touchCommand from './commands/$.touch.mjs';
import basenameCommand from './commands/$.basename.mjs';
import dirnameCommand from './commands/$.dirname.mjs';
import yesCommand from './commands/$.yes.mjs';
import seqCommand from './commands/$.seq.mjs';
import testCommand from './commands/$.test.mjs';

/**
 * Register a virtual command
 * @param {string} name - Command name
 * @param {function} handler - Command handler function
 * @returns {Map} The virtual commands map
 */
export function register(name, handler) {
  trace(
    'VirtualCommands',
    () => `register ENTER | ${JSON.stringify({ name }, null, 2)}`
  );
  virtualCommands.set(name, handler);
  trace(
    'VirtualCommands',
    () => `register EXIT | ${JSON.stringify({ registered: true }, null, 2)}`
  );
  return virtualCommands;
}

/**
 * Unregister a virtual command
 * @param {string} name - Command name to remove
 * @returns {boolean} Whether the command was removed
 */
export function unregister(name) {
  trace(
    'VirtualCommands',
    () => `unregister ENTER | ${JSON.stringify({ name }, null, 2)}`
  );
  const deleted = virtualCommands.delete(name);
  trace(
    'VirtualCommands',
    () => `unregister EXIT | ${JSON.stringify({ deleted }, null, 2)}`
  );
  return deleted;
}

/**
 * List all registered virtual commands
 * @returns {string[]} Array of command names
 */
export function listCommands() {
  const commands = Array.from(virtualCommands.keys());
  trace(
    'VirtualCommands',
    () => `listCommands() returning ${commands.length} commands`
  );
  return commands;
}

/**
 * Register all built-in virtual commands
 */
export function registerBuiltins() {
  trace(
    'VirtualCommands',
    () => 'registerBuiltins() called - registering all built-in commands'
  );

  const globalShellSettings = getShellSettings();

  // Register all imported commands
  register('cd', cdCommand);
  register('pwd', pwdCommand);
  register('echo', echoCommand);
  register('sleep', sleepCommand);
  register('true', trueCommand);
  register('false', falseCommand);
  register('which', createWhichCommand(virtualCommands));
  register('exit', createExitCommand(globalShellSettings));
  register('env', envCommand);
  register('cat', catCommand);
  register('ls', lsCommand);
  register('mkdir', mkdirCommand);
  register('rm', rmCommand);
  register('mv', mvCommand);
  register('cp', cpCommand);
  register('touch', touchCommand);
  register('basename', basenameCommand);
  register('dirname', dirnameCommand);
  register('yes', yesCommand);
  register('seq', seqCommand);
  register('test', testCommand);
}
