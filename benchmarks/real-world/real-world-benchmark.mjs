#!/usr/bin/env node

/**
 * Real-world Use Case Benchmarks
 * Tests command-stream in realistic scenarios like CI/CD, log processing, etc.
 */

import { BenchmarkRunner } from '../lib/benchmark-runner.mjs';
import { $ } from '../../src/$.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class RealWorldBenchmark {
  constructor() {
    this.runner = new BenchmarkRunner({
      iterations: 20,
      warmup: 3,
      outputDir: path.join(__dirname, '../results')
    });
    
    this.setupTestEnvironment();
  }

  /**
   * Setup test environment with realistic data
   */
  setupTestEnvironment() {
    const dataDir = path.join(__dirname, '../temp/real-world-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create fake log files
    this.createLogFiles(dataDir);
    
    // Create fake project structure
    this.createProjectStructure(dataDir);
    
    this.dataDir = dataDir;
  }

  /**
   * Create realistic log files for testing
   */
  createLogFiles(dataDir) {
    const logDir = path.join(dataDir, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create access log
    const accessLog = path.join(logDir, 'access.log');
    if (!fs.existsSync(accessLog)) {
      const logLines = [];
      for (let i = 0; i < 10000; i++) {
        const ip = `192.168.1.${Math.floor(Math.random() * 255)}`;
        const timestamp = new Date(Date.now() - Math.random() * 86400000).toISOString();
        const status = Math.random() > 0.1 ? '200' : Math.random() > 0.5 ? '404' : '500';
        const size = Math.floor(Math.random() * 10000);
        logLines.push(`${ip} - - [${timestamp}] "GET /api/data HTTP/1.1" ${status} ${size}`);
      }
      fs.writeFileSync(accessLog, logLines.join('\n'));
    }

    // Create error log
    const errorLog = path.join(logDir, 'error.log');
    if (!fs.existsSync(errorLog)) {
      const errorLines = [];
      for (let i = 0; i < 1000; i++) {
        const timestamp = new Date(Date.now() - Math.random() * 86400000).toISOString();
        const level = Math.random() > 0.7 ? 'ERROR' : Math.random() > 0.4 ? 'WARN' : 'INFO';
        const message = [
          'Database connection failed',
          'API request timeout',
          'Memory usage high',
          'Cache miss for key',
          'Authentication failed'
        ][Math.floor(Math.random() * 5)];
        errorLines.push(`[${timestamp}] ${level}: ${message} (line ${i + 1})`);
      }
      fs.writeFileSync(errorLog, errorLines.join('\n'));
    }
  }

  /**
   * Create fake project structure
   */
  createProjectStructure(dataDir) {
    const projectDir = path.join(dataDir, 'project');
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // Create some source files
    const srcDir = path.join(projectDir, 'src');
    if (!fs.existsSync(srcDir)) {
      fs.mkdirSync(srcDir, { recursive: true });
    }

    // Create test files
    const files = [
      { name: 'index.js', content: 'console.log("Hello World");\n'.repeat(100) },
      { name: 'utils.js', content: 'function helper() { return true; }\n'.repeat(50) },
      { name: 'config.json', content: JSON.stringify({ env: 'test', debug: true }, null, 2) },
      { name: 'README.md', content: '# Test Project\n\nThis is a test.\n'.repeat(20) }
    ];

    files.forEach(({ name, content }) => {
      const filePath = path.join(srcDir, name);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content);
      }
    });
  }

  /**
   * Benchmark: CI/CD Pipeline Simulation
   */
  async benchmarkCIPipeline() {
    const projectDir = path.join(this.dataDir, 'project');

    const implementations = {
      'command-stream-ci-pipeline': async () => {
        // Simulate a typical CI pipeline
        const steps = [
          // 1. Install dependencies (simulated)
          async () => $`echo "Installing dependencies..."`,
          
          // 2. Lint code
          async () => $`find ${projectDir} -name "*.js" | head -5`,
          
          // 3. Run tests (simulated)
          async () => $`echo "Running tests..." && sleep 0.1`,
          
          // 4. Build project (simulated)
          async () => $`find ${projectDir} -type f | wc -l`,
          
          // 5. Check file sizes
          async () => $`find ${projectDir} -type f -exec ls -la {} \\; | head -10`
        ];

        for (const step of steps) {
          await step();
        }
        
        return 'ci-complete';
      },

      'command-stream-parallel-ci': async () => {
        // Run some steps in parallel
        const parallelSteps = [
          $`find ${projectDir} -name "*.js"`,
          $`find ${projectDir} -name "*.json"`,
          $`find ${projectDir} -name "*.md"`
        ];
        
        const results = await Promise.all(parallelSteps);
        
        // Sequential final step
        await $`echo "Build complete"`;
        
        return results.length;
      }
    };

    return await this.runner.runComparison(
      'CI/CD Pipeline Simulation',
      implementations,
      { iterations: 10, warmup: 2 }
    );
  }

  /**
   * Benchmark: Log Processing
   */
  async benchmarkLogProcessing() {
    const accessLog = path.join(this.dataDir, 'logs/access.log');
    const errorLog = path.join(this.dataDir, 'logs/error.log');

    const implementations = {
      'command-stream-log-analysis': async () => {
        // Typical log analysis tasks
        const errorCount = await $`grep -c "ERROR" ${errorLog}`;
        const topIPs = await $`cut -d' ' -f1 ${accessLog} | sort | uniq -c | sort -nr | head -5`;
        const statusCodes = await $`grep -o " [0-9][0-9][0-9] " ${accessLog} | sort | uniq -c`;
        
        return {
          errors: parseInt(errorCount.stdout.trim()),
          topIPs: topIPs.stdout.split('\n').length,
          statusCodes: statusCodes.stdout.split('\n').length
        };
      },

      'command-stream-streaming-logs': async () => {
        // Process logs with streaming for memory efficiency
        let errorLines = 0;
        for await (const chunk of $`grep "ERROR" ${errorLog}`.stream()) {
          errorLines += chunk.split('\n').filter(line => line.trim()).length;
        }
        
        return errorLines;
      },

      'command-stream-pipeline-logs': async () => {
        // Complex pipeline for log processing
        const result = await $`cat ${accessLog} | grep " 404 " | cut -d' ' -f1 | sort | uniq -c | sort -nr | head -10`;
        return result.stdout.split('\n').filter(line => line.trim()).length;
      }
    };

    return await this.runner.runComparison(
      'Log Processing',
      implementations,
      { iterations: 15, warmup: 2 }
    );
  }

  /**
   * Benchmark: File Operations
   */
  async benchmarkFileOperations() {
    const projectDir = path.join(this.dataDir, 'project');

    const implementations = {
      'command-stream-file-ops': async () => {
        // Common file operations
        const fileCount = await $`find ${projectDir} -type f | wc -l`;
        const totalSize = await $`find ${projectDir} -type f -exec ls -la {} \\; | awk '{sum += $5} END {print sum}'`;
        const jsFiles = await $`find ${projectDir} -name "*.js" | wc -l`;
        
        return {
          files: parseInt(fileCount.stdout.trim()),
          size: parseInt(totalSize.stdout.trim() || '0'),
          jsFiles: parseInt(jsFiles.stdout.trim())
        };
      },

      'command-stream-builtin-ops': async () => {
        // Using built-in commands where possible
        const lsResult = await $`ls -la ${projectDir}/src`;
        const files = lsResult.stdout.split('\n').filter(line => line.includes('.'));
        
        return files.length;
      },

      'command-stream-batch-ops': async () => {
        // Batch file operations
        const operations = [
          $`find ${projectDir} -name "*.js"`,
          $`find ${projectDir} -name "*.json"`,
          $`find ${projectDir} -name "*.md"`
        ];
        
        const results = await Promise.all(operations);
        return results.reduce((sum, result) => sum + result.stdout.split('\n').filter(l => l.trim()).length, 0);
      }
    };

    return await this.runner.runComparison(
      'File Operations',
      implementations,
      { iterations: 25, warmup: 3 }
    );
  }

  /**
   * Benchmark: Network Command Handling
   */
  async benchmarkNetworkCommands() {
    const implementations = {
      'command-stream-network-check': async () => {
        // Basic connectivity and system checks
        const hostname = await $`hostname`;
        const date = await $`date`;
        const whoami = await $`whoami`;
        
        return {
          hostname: hostname.stdout.trim(),
          hasDate: date.stdout.trim().length > 0,
          user: whoami.stdout.trim()
        };
      },

      'command-stream-concurrent-checks': async () => {
        // Run network checks concurrently
        const checks = [
          $`echo "ping test"`,  // Simulate ping
          $`hostname`,
          $`date`,
          $`echo "network ok"`
        ];
        
        const results = await Promise.all(checks);
        return results.every(r => r.code === 0);
      },

      'command-stream-error-handling': async () => {
        // Test error handling with network commands
        const results = [];
        
        try {
          const good = await $`echo "success"`;
          results.push({ status: 'ok', code: good.code });
        } catch (e) {
          results.push({ status: 'error' });
        }
        
        try {
          // This should fail gracefully
          const bad = await $`nonexistent-network-tool-12345`.start({ 
            capture: true, 
            mirror: false 
          });
          results.push({ status: 'handled', code: bad.code });
        } catch (e) {
          results.push({ status: 'caught' });
        }
        
        return results.length;
      }
    };

    return await this.runner.runComparison(
      'Network Command Handling',
      implementations,
      { iterations: 30, warmup: 3 }
    );
  }

  /**
   * Benchmark: Development Workflow
   */
  async benchmarkDevWorkflow() {
    const projectDir = path.join(this.dataDir, 'project');

    const implementations = {
      'command-stream-dev-workflow': async () => {
        // Simulate common development tasks
        const tasks = [
          // Check git status (simulated)
          async () => $`echo "git status simulation"`,
          
          // Find modified files
          async () => $`find ${projectDir} -name "*.js" -newer ${projectDir}/src/config.json 2>/dev/null || echo "no newer files"`,
          
          // Count lines of code
          async () => $`find ${projectDir} -name "*.js" -exec cat {} \\; | wc -l`,
          
          // Check for TODOs
          async () => $`find ${projectDir} -name "*.js" -exec grep -l "TODO\\|FIXME" {} \\; 2>/dev/null || echo "no todos"`,
          
          // Generate file list
          async () => $`find ${projectDir} -type f | sort`
        ];

        const results = [];
        for (const task of tasks) {
          const result = await task();
          results.push(result.code === 0);
        }
        
        return results.filter(Boolean).length;
      },

      'command-stream-streaming-workflow': async () => {
        // Use streaming for large operations
        let lineCount = 0;
        for await (const chunk of $`find ${projectDir} -name "*.js" -exec cat {} \\;`.stream()) {
          lineCount += chunk.split('\n').length;
        }
        
        return lineCount > 0;
      }
    };

    return await this.runner.runComparison(
      'Development Workflow',
      implementations,
      { iterations: 15, warmup: 2 }
    );
  }

  /**
   * Run all real-world benchmarks
   */
  async runAllBenchmarks() {
    console.log('🌍 Starting Real-World Use Case Benchmarks');
    console.log('==========================================\n');

    const results = {};

    try {
      results.ciPipeline = await this.benchmarkCIPipeline();
      results.logProcessing = await this.benchmarkLogProcessing();
      results.fileOperations = await this.benchmarkFileOperations();
      results.networkCommands = await this.benchmarkNetworkCommands();
      results.devWorkflow = await this.benchmarkDevWorkflow();

      console.log('\n🏁 Real-World Benchmarks Complete!');
      console.log('==================================');

      // Save all results
      await this.runner.saveResults('real-world-results.json');
      await this.runner.generateHTMLReport('real-world-report.html');

      return results;

    } catch (error) {
      console.error('❌ Real-world benchmark suite failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup test environment
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
  const benchmark = new RealWorldBenchmark();
  
  benchmark.runAllBenchmarks()
    .then(() => {
      console.log('✅ All real-world benchmarks completed successfully');
      benchmark.cleanup();
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Real-world benchmarks failed:', error);
      benchmark.cleanup();
      process.exit(1);
    });
}

export default RealWorldBenchmark;