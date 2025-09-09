#!/usr/bin/env node

/**
 * Performance Benchmark Suite
 * Tests process spawning, streaming, and pipeline performance
 */

import { BenchmarkRunner } from '../lib/benchmark-runner.mjs';
import { $ } from '../../src/$.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class PerformanceBenchmark {
  constructor() {
    this.runner = new BenchmarkRunner({
      iterations: 50,
      warmup: 5,
      outputDir: path.join(__dirname, '../results')
    });
    
    // Create test data
    this.createTestData();
  }

  /**
   * Create test data files for benchmarks
   */
  createTestData() {
    const dataDir = path.join(__dirname, '../temp/test-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create test files of various sizes
    const sizes = {
      'small.txt': 1024,      // 1KB
      'medium.txt': 102400,   // 100KB
      'large.txt': 1048576    // 1MB
    };

    Object.entries(sizes).forEach(([filename, size]) => {
      const filePath = path.join(dataDir, filename);
      if (!fs.existsSync(filePath)) {
        const content = 'Test data line\n'.repeat(Math.floor(size / 15));
        fs.writeFileSync(filePath, content);
      }
    });

    this.testDataDir = dataDir;
  }

  /**
   * Test basic command execution speed
   */
  async benchmarkBasicExecution() {
    const implementations = {
      'command-stream': async () => {
        const result = await $`echo "performance test"`;
        return result.stdout;
      },

      'command-stream-streaming': async () => {
        let output = '';
        for await (const chunk of $`echo "performance test"`.stream()) {
          output += chunk;
        }
        return output;
      },

      'command-stream-events': async () => {
        return new Promise((resolve, reject) => {
          let output = '';
          $`echo "performance test"`
            .on('data', chunk => { output += chunk; })
            .on('end', result => resolve(output))
            .on('error', reject);
        });
      }

      // Note: Competitors would be tested here if they were installed
      // 'execa': async () => { const {stdout} = await execa('echo', ['performance test']); return stdout; },
      // 'cross-spawn': async () => { /* implementation */ },
      // etc.
    };

    return await this.runner.runComparison(
      'Basic Command Execution',
      implementations,
      { iterations: 100, warmup: 10 }
    );
  }

  /**
   * Test file processing performance
   */
  async benchmarkFileProcessing() {
    const smallFile = path.join(this.testDataDir, 'small.txt');
    const mediumFile = path.join(this.testDataDir, 'medium.txt');

    const implementations = {
      'command-stream-cat': async () => {
        const result = await $`cat ${smallFile}`;
        return result.stdout.length;
      },

      'command-stream-builtin-cat': async () => {
        // Test built-in cat command
        const result = await $`cat ${smallFile}`;
        return result.stdout.length;
      },

      'command-stream-streaming': async () => {
        let totalLength = 0;
        for await (const chunk of $`cat ${smallFile}`.stream()) {
          totalLength += chunk.length;
        }
        return totalLength;
      },

      'node-fs-readFile': async () => {
        const content = await fs.promises.readFile(smallFile, 'utf-8');
        return content.length;
      }
    };

    return await this.runner.runComparison(
      'File Processing (1KB)',
      implementations,
      { iterations: 200, warmup: 20 }
    );
  }

  /**
   * Test large file streaming performance
   */
  async benchmarkLargeFileStreaming() {
    const largeFile = path.join(this.testDataDir, 'large.txt');

    const implementations = {
      'command-stream-buffered': async () => {
        const result = await $`cat ${largeFile}`;
        return result.stdout.length;
      },

      'command-stream-streaming': async () => {
        let totalLength = 0;
        let chunkCount = 0;
        for await (const chunk of $`cat ${largeFile}`.stream()) {
          totalLength += chunk.length;
          chunkCount++;
        }
        return { totalLength, chunkCount };
      },

      'command-stream-events': async () => {
        return new Promise((resolve, reject) => {
          let totalLength = 0;
          let chunkCount = 0;
          
          $`cat ${largeFile}`
            .on('data', chunk => {
              totalLength += chunk.length;
              chunkCount++;
            })
            .on('end', () => resolve({ totalLength, chunkCount }))
            .on('error', reject);
        });
      }
    };

    return await this.runner.runComparison(
      'Large File Streaming (1MB)',
      implementations,
      { iterations: 20, warmup: 3 }
    );
  }

  /**
   * Test pipeline performance
   */
  async benchmarkPipelines() {
    const mediumFile = path.join(this.testDataDir, 'medium.txt');

    const implementations = {
      'command-stream-pipe': async () => {
        const result = await $`cat ${mediumFile} | head -10 | wc -l`;
        return parseInt(result.stdout.trim());
      },

      'command-stream-builtin-pipe': async () => {
        // Test with built-in commands in pipeline
        const result = await $`cat ${mediumFile} | head -10`;
        return result.stdout.split('\n').length;
      },

      'command-stream-programmatic': async () => {
        // Programmatic pipeline using .pipe() method
        const head = $`head -10`;
        const wc = $`wc -l`;
        const result = await $`cat ${mediumFile}`.pipe(head).pipe(wc);
        return parseInt(result.stdout.trim());
      }
    };

    return await this.runner.runComparison(
      'Pipeline Processing',
      implementations,
      { iterations: 50, warmup: 5 }
    );
  }

  /**
   * Test concurrent execution
   */
  async benchmarkConcurrentExecution() {
    const implementations = {
      'command-stream-sequential': async () => {
        const results = [];
        for (let i = 0; i < 10; i++) {
          const result = await $`echo "test ${i}"`;
          results.push(result.stdout.trim());
        }
        return results.length;
      },

      'command-stream-concurrent': async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push($`echo "test ${i}"`);
        }
        const results = await Promise.all(promises);
        return results.length;
      },

      'command-stream-concurrent-streaming': async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push((async () => {
            let output = '';
            for await (const chunk of $`echo "test ${i}"`.stream()) {
              output += chunk;
            }
            return output.trim();
          })());
        }
        const results = await Promise.all(promises);
        return results.length;
      }
    };

    return await this.runner.runComparison(
      'Concurrent Execution (10 processes)',
      implementations,
      { iterations: 30, warmup: 3 }
    );
  }

  /**
   * Test error handling performance
   */
  async benchmarkErrorHandling() {
    const implementations = {
      'command-stream-try-catch': async () => {
        try {
          await $`nonexistent-command-12345`;
          return 'unexpected-success';
        } catch (error) {
          return 'error-caught';
        }
      },

      'command-stream-shell-errexit-off': async () => {
        // With errexit off, errors don't throw
        const result = await $`nonexistent-command-12345`.start({ 
          capture: true,
          mirror: false 
        });
        return result.code === 0 ? 'success' : 'error-code';
      },

      'command-stream-events-error': async () => {
        return new Promise((resolve) => {
          $`nonexistent-command-12345`
            .on('error', () => resolve('error-event'))
            .on('end', result => resolve(result.code === 0 ? 'success' : 'error-code'));
        });
      }
    };

    return await this.runner.runComparison(
      'Error Handling',
      implementations,
      { iterations: 100, warmup: 10 }
    );
  }

  /**
   * Test memory usage under load
   */
  async benchmarkMemoryUsage() {
    const largeFile = path.join(this.testDataDir, 'large.txt');

    const implementations = {
      'command-stream-streaming-memory': async () => {
        let processedBytes = 0;
        for await (const chunk of $`cat ${largeFile}`.stream()) {
          processedBytes += chunk.length;
          // Simulate processing without accumulating
        }
        return processedBytes;
      },

      'command-stream-buffered-memory': async () => {
        const result = await $`cat ${largeFile}`;
        return result.stdout.length;
      }
    };

    return await this.runner.runComparison(
      'Memory Usage Comparison',
      implementations,
      { iterations: 10, warmup: 2 }
    );
  }

  /**
   * Run all performance benchmarks
   */
  async runAllBenchmarks() {
    console.log('🚀 Starting Performance Benchmark Suite');
    console.log('========================================\n');

    const results = {};

    try {
      results.basicExecution = await this.benchmarkBasicExecution();
      results.fileProcessing = await this.benchmarkFileProcessing();
      results.largeFileStreaming = await this.benchmarkLargeFileStreaming();
      results.pipelines = await this.benchmarkPipelines();
      results.concurrentExecution = await this.benchmarkConcurrentExecution();
      results.errorHandling = await this.benchmarkErrorHandling();
      results.memoryUsage = await this.benchmarkMemoryUsage();

      console.log('\n🏁 Performance Benchmark Complete!');
      console.log('===================================');

      // Save all results
      await this.runner.saveResults('performance-results.json');
      await this.runner.generateHTMLReport('performance-report.html');

      return results;

    } catch (error) {
      console.error('❌ Benchmark suite failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup test data
   */
  cleanup() {
    const tempDir = path.join(__dirname, '../temp');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const benchmark = new PerformanceBenchmark();
  
  benchmark.runAllBenchmarks()
    .then(() => {
      console.log('✅ All benchmarks completed successfully');
      benchmark.cleanup();
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Benchmark failed:', error);
      benchmark.cleanup();
      process.exit(1);
    });
}

export default PerformanceBenchmark;