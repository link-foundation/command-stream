import { test, expect, describe } from 'bun:test';
import { $ } from '../$.mjs';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

// Get all .mjs examples
const examplesDir = join(process.cwd(), 'examples');
const allExamples = readdirSync(examplesDir)
  .filter(file => file.endsWith('.mjs') && statSync(join(examplesDir, file)).isFile())
  .sort();

// Filter examples based on their content to avoid Bun-specific features
const nodeCompatibleExamples = allExamples.filter(exampleFile => {
  const content = readFileSync(join(examplesDir, exampleFile), 'utf8');
  return !content.includes('Bun.spawn') && !content.includes('Bun.file');
});

describe('Examples Execution Tests', () => {
  // Core functionality test - our main example should work
  test('readme-example.mjs should execute and demonstrate new API signature', async () => {
    const result = await $`node examples/readme-example.mjs`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Hello, World!');
    expect(result.stdout).toContain('Hello, Mr. Smith!');
    expect(result.stdout).toContain('"stdinLength": 11');
    expect(result.stdout).toContain('"mirror": true');
    expect(result.stdout).toContain('"capture": true');
  });

  // JSON streaming test - key feature
  test('simple-jq-streaming.mjs should complete successfully', async () => {
    const result = await $`node examples/simple-jq-streaming.mjs`;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('✅ Streaming completed successfully!');
    expect(result.stdout).toContain('🎉 All tests passed!');
    expect(result.stdout).toContain('JSON streaming with jq works');
  });

  // Summary test to report on examples
  test('should have examples available for manual testing', () => {
    console.log(`\n📊 Examples Summary:`);
    console.log(`   Total examples: ${allExamples.length}`);
    console.log(`   Node-compatible: ${nodeCompatibleExamples.length}`);
    console.log(`   Bun-specific: ${allExamples.length - nodeCompatibleExamples.length}`);
    
    // Show a few example files for manual testing
    const manualTestExamples = [
      'debug-streaming.mjs',
      'working-streaming-demo.mjs',
      'test-simple-pipe.mjs'
    ].filter(ex => nodeCompatibleExamples.includes(ex));
    
    if (manualTestExamples.length > 0) {
      console.log(`\n   Recommended for manual testing:`);
      manualTestExamples.forEach(ex => console.log(`     node examples/${ex}`));
    }
    
    expect(allExamples.length).toBeGreaterThan(0);
    expect(nodeCompatibleExamples.length).toBeGreaterThan(0);
  });
});