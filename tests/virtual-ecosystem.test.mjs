import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $, shell, enableVirtualCommands, installPackage, createVirtualCommand, extendCommand, composeCommands, marketplace, cleanupEcosystemState, unregister, listCommands } from '../src/$.mjs';

// Helper function to setup shell settings
function setupShellSettings() {
  shell.errexit(false);
  shell.verbose(false);
  shell.xtrace(false);
  shell.pipefail(false);
  shell.nounset(false);
  enableVirtualCommands();
}

describe('Virtual Commands Ecosystem', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
    cleanupEcosystemState();
    
    // Clean up any custom commands from previous tests
    const commands = listCommands();
    const customCommands = commands.filter(cmd => 
      !['cd', 'pwd', 'echo', 'sleep', 'true', 'false', 'which', 'exit', 'env', 'cat', 'ls', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'basename', 'dirname', 'yes', 'seq', 'test'].includes(cmd)
    );
    customCommands.forEach(cmd => unregister(cmd));
    
    setupShellSettings();
  });
  
  afterEach(async () => {
    cleanupEcosystemState();
    await afterTestCleanup();
  });

  describe('Package Installation System', () => {
    test('should install git-tools package and register commands', async () => {
      const result = await $.install('@command-stream/git-tools');
      
      expect(result.success).toBe(true);
      expect(result.commands).toContain('git-status-clean');
      expect(result.commands).toContain('git-branch-list');
    });

    test('should install file-tools package and register commands', async () => {
      const result = await $.install('@command-stream/file-tools');
      
      expect(result.success).toBe(true);
      expect(result.commands).toContain('enhanced-ls');
      expect(result.commands).toContain('tree-view');
    });

    test('should prevent duplicate installations without force', async () => {
      await $.install('@command-stream/git-tools');
      const result = await $.install('@command-stream/git-tools');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('already installed');
    });

    test('should allow forced reinstallation', async () => {
      await $.install('@command-stream/git-tools');
      const result = await $.install('@command-stream/git-tools', { force: true });
      
      expect(result.success).toBe(true);
    });

    test('should handle package not found', async () => {
      const result = await $.install('@nonexistent/package');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should execute installed git commands', async () => {
      await $.install('@command-stream/git-tools');
      
      const statusResult = await $`git-status-clean`;
      expect(statusResult.code).toBe(0);
      expect(statusResult.stdout).toContain('Working directory clean');
      
      const branchResult = await $`git-branch-list`;
      expect(branchResult.code).toBe(0);
      expect(branchResult.stdout).toContain('main');
    });

    test('should execute installed file commands', async () => {
      await $.install('@command-stream/file-tools');
      
      const lsResult = await $`enhanced-ls`;
      expect(lsResult.code).toBe(0);
      expect(lsResult.stdout).toContain('file1.txt');
      
      const treeResult = await $`tree-view`;
      expect(treeResult.code).toBe(0);
      expect(treeResult.stdout).toContain('├──');
    });

    test('should execute deploy command with arguments', async () => {
      await $.install('@command-stream/deploy-tools');
      
      const deployResult = await $`deploy production`;
      expect(deployResult.code).toBe(0);
      expect(deployResult.stdout).toContain('Deploying to production');
      expect(deployResult.stdout).toContain('Deployment successful!');
    });
  });

  describe('Custom Command Creation', () => {
    test('should create and execute basic custom command', async () => {
      const result = $.create('greet', async ({ args }) => {
        const name = args[0] || 'World';
        return { stdout: `Hello, ${name}!\n`, stderr: '', code: 0 };
      });

      expect(result.registered).toBe(true);
      expect(result.name).toBe('greet');

      const cmdResult = await $`greet Alice`;
      expect(cmdResult.stdout).toBe('Hello, Alice!\n');
      expect(cmdResult.code).toBe(0);
    });

    test('should create command with error handling', async () => {
      $.create('fail-test', async ({ args }) => {
        if (args[0] === 'error') {
          throw new Error('Test error');
        }
        return { stdout: 'Success\n', stderr: '', code: 0 };
      });

      const successResult = await $`fail-test success`;
      expect(successResult.code).toBe(0);
      expect(successResult.stdout).toBe('Success\n');

      const errorResult = await $`fail-test error`;
      expect(errorResult.code).toBe(1);
      expect(errorResult.stderr).toContain('Test error');
    });

    test('should create streaming command with async generator', async () => {
      $.create('stream-numbers', async function* ({ args }) {
        const count = parseInt(args[0]) || 3;
        for (let i = 1; i <= count; i++) {
          yield `Number ${i}\n`;
          // Small delay to simulate actual streaming
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }, { streaming: true });

      const result = await $`stream-numbers 2`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Number 1\nNumber 2\n');
    });

    test('should validate command creation parameters', () => {
      expect(() => {
        $.create('', () => {});
      }).toThrow('Command name must be a valid string');

      expect(() => {
        $.create('test-cmd', null);
      }).toThrow('Command handler must be a function');
    });
  });

  describe('Command Extension and Middleware', () => {
    test('should extend existing command with simple middleware', async () => {
      // First create a base command
      $.create('base-cmd', async ({ args }) => {
        return { stdout: args.join(' ') + '\n', stderr: '', code: 0 };
      });

      // Extend it with middleware
      const extendResult = $.extend('base-cmd', async (result, context) => {
        return {
          ...result,
          stdout: '[EXTENDED] ' + result.stdout
        };
      });

      expect(extendResult.extended).toBe(true);
      expect(extendResult.command).toBe('base-cmd');

      const cmdResult = await $`base-cmd hello world`;
      expect(cmdResult.stdout).toBe('[EXTENDED] hello world\n');
    });

    test('should extend command with pre/post middleware', async () => {
      $.create('log-cmd', async ({ args }) => {
        return { stdout: `Output: ${args.join(' ')}\n`, stderr: '', code: 0 };
      });

      $.extend('log-cmd', {
        pre: async (context) => {
          // Modify args before execution
          return { ...context, args: context.args.map(arg => arg.toUpperCase()) };
        },
        post: async (result, context) => {
          // Modify result after execution
          return {
            ...result,
            stdout: `[POST] ${result.stdout}`
          };
        }
      });

      const result = await $`log-cmd hello world`;
      expect(result.stdout).toBe('[POST] Output: HELLO WORLD\n');
    });

    test('should handle multiple middleware layers', async () => {
      $.create('multi-cmd', async ({ args }) => {
        return { stdout: args.join(' ') + '\n', stderr: '', code: 0 };
      });

      // First extension
      $.extend('multi-cmd', async (result) => ({
        ...result,
        stdout: '[FIRST] ' + result.stdout
      }));

      // Second extension
      $.extend('multi-cmd', async (result) => ({
        ...result,
        stdout: '[SECOND] ' + result.stdout
      }));

      const result = await $`multi-cmd test`;
      expect(result.stdout).toBe('[SECOND] [FIRST] test\n');
    });

    test('should validate extension parameters', () => {
      expect(() => {
        $.extend('', () => {});
      }).toThrow('Command name must be a valid string');

      expect(() => {
        $.extend('nonexistent', () => {});
      }).toThrow('Command nonexistent not found');

      expect(() => {
        $.extend('echo', null);
      }).toThrow('Middleware must be a function');
    });
  });

  describe('Command Composition System', () => {
    test('should compose commands in sequence mode', async () => {
      // Create individual commands
      $.create('cmd1', async () => ({ stdout: 'First\n', stderr: '', code: 0 }));
      $.create('cmd2', async () => ({ stdout: 'Second\n', stderr: '', code: 0 }));

      const composeResult = $.compose('sequence-test', ['cmd1', 'cmd2'], { mode: 'sequence' });
      expect(composeResult.registered).toBe(true);
      expect(composeResult.commands).toBe(2);

      const result = await $`sequence-test`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('First\nSecond\n');
    });

    test('should compose commands in pipeline mode', async () => {
      $.create('producer', async () => ({ stdout: 'data', stderr: '', code: 0 }));
      $.create('processor', async ({ stdin }) => ({ 
        stdout: `processed: ${stdin}\n`, 
        stderr: '', 
        code: 0 
      }));

      $.compose('pipeline-test', ['producer', 'processor'], { mode: 'pipeline' });

      const result = await $`pipeline-test`;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('processed: data\n');
    });

    test('should handle command composition errors', async () => {
      $.create('good-cmd', async () => ({ stdout: 'OK\n', stderr: '', code: 0 }));
      $.create('bad-cmd', async () => ({ stdout: '', stderr: 'Error\n', code: 1 }));

      // Should stop on error by default
      $.compose('error-test', ['good-cmd', 'bad-cmd'], { mode: 'sequence' });

      const result = await $`error-test`;
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('OK\n');
    });

    test('should continue on error when configured', async () => {
      $.create('good-cmd2', async () => ({ stdout: 'OK\n', stderr: '', code: 0 }));
      $.create('bad-cmd2', async () => ({ stdout: '', stderr: 'Error\n', code: 1 }));
      $.create('final-cmd', async () => ({ stdout: 'Final\n', stderr: '', code: 0 }));

      $.compose('continue-test', ['good-cmd2', 'bad-cmd2', 'final-cmd'], { 
        mode: 'sequence', 
        continueOnError: true 
      });

      const result = await $`continue-test`;
      expect(result.code).toBe(0); // Final command succeeded
      expect(result.stdout).toBe('OK\nFinal\n');
    });

    test('should validate composition parameters', () => {
      expect(() => {
        $.compose('', []);
      }).toThrow('Composed command name must be a valid string');

      expect(() => {
        $.compose('test', []);
      }).toThrow('Commands must be a non-empty array');

      expect(() => {
        $.compose('test', null);
      }).toThrow('Commands must be a non-empty array');
    });
  });

  describe('Marketplace System', () => {
    test('should search marketplace with query', async () => {
      const results = await $.marketplace.search('git');
      
      expect(results.query).toBe('git');
      expect(results.total).toBeGreaterThan(0);
      expect(results.results.length).toBeGreaterThan(0);
      
      const gitTools = results.results.find(r => r.name === '@command-stream/git-tools');
      expect(gitTools).toBeDefined();
      expect(gitTools.commands).toContain('git-status-clean');
    });

    test('should search marketplace with description match', async () => {
      const results = await $.marketplace.search('file system');
      
      expect(results.total).toBeGreaterThan(0);
      const fileTools = results.results.find(r => r.name === '@command-stream/file-tools');
      expect(fileTools).toBeDefined();
    });

    test('should search marketplace with command name match', async () => {
      const results = await $.marketplace.search('deploy');
      
      expect(results.total).toBeGreaterThan(0);
      const deployTools = results.results.find(r => r.name === '@command-stream/deploy-tools');
      expect(deployTools).toBeDefined();
    });

    test('should limit search results', async () => {
      const results = await $.marketplace.search('tools', { limit: 1 });
      
      expect(results.results.length).toBe(1);
    });

    test('should get package info', async () => {
      const info = await $.marketplace.info('@command-stream/git-tools');
      
      expect(info.name).toBe('@command-stream/git-tools');
      expect(info.version).toBe('1.0.0');
      expect(info.commands).toContain('git-status-clean');
      expect(info.installed).toBe(false);
    });

    test('should show installed status in package info', async () => {
      await $.install('@command-stream/git-tools');
      const info = await $.marketplace.info('@command-stream/git-tools');
      
      expect(info.installed).toBe(true);
    });

    test('should handle package not found in info', async () => {
      await expect($.marketplace.info('@nonexistent/package')).rejects.toThrow('not found');
    });

    test('should list installed packages', async () => {
      await $.install('@command-stream/git-tools');
      await $.install('@command-stream/file-tools');
      
      const installed = $.marketplace.list();
      
      expect(installed.length).toBe(2);
      expect(installed.find(p => p.name === '@command-stream/git-tools')).toBeDefined();
      expect(installed.find(p => p.name === '@command-stream/file-tools')).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    test('should demonstrate complete ecosystem workflow', async () => {
      // 1. Search marketplace
      const searchResults = await $.marketplace.search('git');
      expect(searchResults.results.length).toBeGreaterThan(0);

      // 2. Install package
      const installResult = await $.install('@command-stream/git-tools');
      expect(installResult.success).toBe(true);

      // 3. Use installed command
      const gitResult = await $`git-status-clean`;
      expect(gitResult.code).toBe(0);

      // 4. Create custom command
      $.create('git-quick-status', async () => {
        return { stdout: 'Quick status: All good!\n', stderr: '', code: 0 };
      });

      // 5. Extend existing command
      $.extend('git-status-clean', async (result) => ({
        ...result,
        stdout: '[ENHANCED] ' + result.stdout
      }));

      const enhancedResult = await $`git-status-clean`;
      expect(enhancedResult.stdout).toContain('[ENHANCED]');

      // 6. Compose commands
      $.compose('git-full-check', ['git-status-clean', 'git-quick-status'], { 
        mode: 'sequence' 
      });

      const composedResult = await $`git-full-check`;
      expect(composedResult.stdout).toContain('Working directory clean');
      expect(composedResult.stdout).toContain('Quick status: All good!');

      // 7. Check marketplace listing
      const installedPackages = $.marketplace.list();
      expect(installedPackages.length).toBeGreaterThan(0);
    });

    test('should handle complex streaming and composition', async () => {
      // Create streaming data producer
      $.create('data-stream', async function* ({ args }) {
        const items = ['item1', 'item2', 'item3'];
        for (const item of items) {
          yield `${item}\n`;
        }
      }, { streaming: true });

      // Create data processor
      $.create('process-data', async ({ stdin }) => {
        const processed = (stdin || '').split('\n')
          .filter(line => line.trim())
          .map(line => `processed: ${line}`)
          .join('\n');
        return { stdout: processed + '\n', stderr: '', code: 0 };
      });

      // Compose them
      $.compose('stream-pipeline', ['data-stream', 'process-data'], { 
        mode: 'pipeline' 
      });

      const result = await $`stream-pipeline`;
      expect(result.stdout).toContain('processed: item1');
      expect(result.stdout).toContain('processed: item2');
      expect(result.stdout).toContain('processed: item3');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid package installation gracefully', async () => {
      const result = await $.install(null);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Package name must be a valid string');
    });

    test('should handle command creation with invalid parameters', () => {
      expect(() => $.create(123, () => {})).toThrow();
      expect(() => $.create('test', 'not a function')).toThrow();
    });

    test('should handle extension of non-existent commands', () => {
      expect(() => $.extend('does-not-exist', () => {})).toThrow('Command does-not-exist not found');
    });

    test('should handle composition with invalid commands', async () => {
      $.compose('invalid-compose', ['nonexistent-cmd'], { mode: 'sequence' });
      
      const result = await $`invalid-compose`;
      expect(result.code).toBe(1);
    });

    test('should handle marketplace search with empty query', async () => {
      const results = await $.marketplace.search('');
      expect(results.results).toBeDefined();
      expect(Array.isArray(results.results)).toBe(true);
    });
  });
});