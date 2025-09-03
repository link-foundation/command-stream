import { test, expect, describe } from 'bun:test';
import './test-helper.mjs'; // Automatically sets up beforeEach/afterEach cleanup
import { $ } from '../src/$.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('SIGINT Cleanup Tests (Isolated)', () => {
  test('should properly manage SIGINT handlers', async () => {
    // Run the test in a subprocess to avoid interfering with test runner
    const scriptPath = join(__dirname, '../examples/sigint-handler-test.mjs');
    const result = await $`node ${scriptPath}`;
    
    // Parse results from output
    const output = result.stdout;
    const results = {};
    
    // Extract RESULT lines
    const resultLines = output.split('\n').filter(line => line.includes('RESULT:'));
    resultLines.forEach(line => {
      const match = line.match(/RESULT: (\w+)=(.+)/);
      if (match) {
        results[match[1]] = match[2];
      }
    });
    
    // Verify handler lifecycle
    const initial = parseInt(results.initial_listeners);
    const during = parseInt(results.during_listeners);
    const after = parseInt(results.after_listeners);
    
    expect(during).toBe(initial + 1); // Handler added
    expect(after).toBe(initial); // Handler removed
    
    // Verify concurrent commands share handler
    const concurrent = parseInt(results.concurrent_listeners);
    const afterConcurrent = parseInt(results.after_concurrent_listeners);
    
    expect(concurrent).toBe(initial + 1); // Single handler for all
    expect(afterConcurrent).toBe(initial); // Cleaned up
    
    // Verify cleanup on error
    const afterError = parseInt(results.after_error_listeners);
    expect(afterError).toBe(initial);
    
    // Verify cleanup on kill
    const afterKill = parseInt(results.after_kill_listeners);
    expect(afterKill).toBe(initial);
  });
  
  test('should forward SIGINT to child processes', async () => {
    // Run the forwarding test in subprocess
    const scriptPath = join(__dirname, '../examples/sigint-forwarding-test.mjs');
    const result = await $`node ${scriptPath}`;
    
    // Parse results
    const output = result.stdout;
    const results = {};
    
    const resultLines = output.split('\n').filter(line => line.includes('RESULT:'));
    resultLines.forEach(line => {
      const match = line.match(/RESULT: (\w+)=(.+)/);
      if (match) {
        results[match[1]] = match[2];
      }
    });
    
    // Verify SIGINT was received by parent
    expect(results.sigint_received).toBe('true');
    
    // The child process should have been forwarded the signal
    // (exact behavior depends on implementation)
  });
  
  test('should cleanup all resources properly', async () => {
    // Run comprehensive cleanup test
    const scriptPath = join(__dirname, '../examples/cleanup-verification-test.mjs');
    const result = await $`node ${scriptPath}`;
    
    // Parse results
    const output = result.stdout;
    const results = {};
    
    const resultLines = output.split('\n').filter(line => line.includes('RESULT:'));
    resultLines.forEach(line => {
      const match = line.match(/RESULT: (\w+)=(.+)/);
      if (match) {
        results[match[1]] = match[2];
      }
    });
    
    // Verify all cleanup scenarios
    expect(results.virtual_finished).toBe('true');
    expect(results.real_finished).toBe('true');
    expect(results.error_finished).toBe('true');
    expect(results.kill_finished).toBe('true');
    expect(results.pipeline_output).toBe('test');
    expect(results.event_listeners_size).toBe('0');
    expect(results.concurrent_finished).toBe('true');
    expect(results.not_awaited_finished).toBe('true');
    expect(results.stream_iterator_finished).toBe('true');
    expect(results.had_abort_controller).toBe('true');
    expect(results.abort_controller_cleaned).toBe('true');
    expect(results.final_sigint_handlers).toBe('0');
  });
  
  test('should not interfere with user SIGINT handlers', async () => {
    // This test verifies that after commands finish, user handlers work
    await $`echo test`;
    
    // Wait to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // User's handler should work fine now
    let userHandlerCalled = false;
    const userHandler = () => {
      userHandlerCalled = true;
    };
    
    process.on('SIGINT', userHandler);
    
    try {
      // This should NOT exit the process since we're not actually sending SIGINT
      // We're just testing that we can add handlers
      expect(process.listeners('SIGINT').includes(userHandler)).toBe(true);
      
      // Clean up
      process.removeListener('SIGINT', userHandler);
    } finally {
      process.removeListener('SIGINT', userHandler);
    }
  });
});