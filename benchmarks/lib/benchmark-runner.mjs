#!/usr/bin/env node

/**
 * Comprehensive Benchmarking Suite for command-stream
 * Compares against major competitors: execa, cross-spawn, ShellJS, zx, Bun.$
 */

import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class BenchmarkRunner {
  constructor(options = {}) {
    this.results = {};
    this.options = {
      iterations: 100,
      warmup: 10,
      outputDir: path.join(__dirname, '../results'),
      ...options
    };
    
    // Ensure output directory exists
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  /**
   * Run a single benchmark with timing and memory measurement
   */
  async runBenchmark(name, fn, options = {}) {
    const config = { ...this.options, ...options };
    const results = {
      name,
      iterations: config.iterations,
      warmup: config.warmup,
      times: [],
      memoryBefore: 0,
      memoryAfter: 0,
      avgTime: 0,
      minTime: Infinity,
      maxTime: -Infinity,
      medianTime: 0,
      p95Time: 0,
      p99Time: 0,
      memoryDelta: 0,
      errors: []
    };

    console.log(`\n🔄 Running benchmark: ${name}`);
    console.log(`   Warmup: ${config.warmup} iterations`);
    console.log(`   Main: ${config.iterations} iterations`);

    // Warmup runs
    for (let i = 0; i < config.warmup; i++) {
      try {
        await fn();
        if (global.gc) global.gc(); // Force garbage collection if available
      } catch (error) {
        console.warn(`Warmup iteration ${i} failed:`, error.message);
      }
    }

    // Measure initial memory
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();
    results.memoryBefore = memBefore.heapUsed;

    // Main benchmark runs
    for (let i = 0; i < config.iterations; i++) {
      try {
        const startTime = performance.now();
        await fn();
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        results.times.push(duration);
        results.minTime = Math.min(results.minTime, duration);
        results.maxTime = Math.max(results.maxTime, duration);
        
        if ((i + 1) % Math.max(1, Math.floor(config.iterations / 10)) === 0) {
          process.stdout.write('.');
        }
      } catch (error) {
        results.errors.push({
          iteration: i,
          error: error.message,
          stack: error.stack
        });
        console.warn(`\n⚠️  Iteration ${i} failed:`, error.message);
      }
    }

    // Measure final memory
    if (global.gc) global.gc();
    const memAfter = process.memoryUsage();
    results.memoryAfter = memAfter.heapUsed;
    results.memoryDelta = results.memoryAfter - results.memoryBefore;

    // Calculate statistics
    if (results.times.length > 0) {
      results.avgTime = results.times.reduce((a, b) => a + b, 0) / results.times.length;
      
      const sortedTimes = results.times.slice().sort((a, b) => a - b);
      const len = sortedTimes.length;
      results.medianTime = len % 2 === 0 
        ? (sortedTimes[len / 2 - 1] + sortedTimes[len / 2]) / 2
        : sortedTimes[Math.floor(len / 2)];
      
      results.p95Time = sortedTimes[Math.floor(len * 0.95)];
      results.p99Time = sortedTimes[Math.floor(len * 0.99)];
    }

    console.log(`\n✅ Benchmark completed: ${name}`);
    this.printResults(results);
    
    return results;
  }

  /**
   * Print benchmark results in a readable format
   */
  printResults(results) {
    console.log(`\n📊 Results for ${results.name}:`);
    console.log(`   Success rate: ${((results.iterations - results.errors.length) / results.iterations * 100).toFixed(1)}%`);
    
    if (results.times.length > 0) {
      console.log(`   Average time: ${results.avgTime.toFixed(2)}ms`);
      console.log(`   Median time:  ${results.medianTime.toFixed(2)}ms`);
      console.log(`   Min time:     ${results.minTime.toFixed(2)}ms`);
      console.log(`   Max time:     ${results.maxTime.toFixed(2)}ms`);
      console.log(`   95th percentile: ${results.p95Time.toFixed(2)}ms`);
      console.log(`   99th percentile: ${results.p99Time.toFixed(2)}ms`);
    }
    
    console.log(`   Memory delta: ${(results.memoryDelta / 1024 / 1024).toFixed(2)}MB`);
    
    if (results.errors.length > 0) {
      console.log(`   Errors: ${results.errors.length}/${results.iterations}`);
    }
  }

  /**
   * Run a comparison between multiple implementations
   */
  async runComparison(name, implementations, options = {}) {
    console.log(`\n🏁 Starting comparison: ${name}`);
    
    const comparisonResults = {
      name,
      timestamp: new Date().toISOString(),
      implementations: {},
      winner: null,
      rankings: []
    };

    for (const [implName, implFn] of Object.entries(implementations)) {
      try {
        const result = await this.runBenchmark(`${name} - ${implName}`, implFn, options);
        comparisonResults.implementations[implName] = result;
      } catch (error) {
        console.error(`❌ Failed to run ${implName}:`, error.message);
        comparisonResults.implementations[implName] = {
          name: `${name} - ${implName}`,
          error: error.message,
          failed: true
        };
      }
    }

    // Calculate rankings based on average time (lower is better)
    const validResults = Object.entries(comparisonResults.implementations)
      .filter(([_, result]) => !result.failed && result.times && result.times.length > 0)
      .map(([name, result]) => ({ name, avgTime: result.avgTime, result }))
      .sort((a, b) => a.avgTime - b.avgTime);

    comparisonResults.rankings = validResults.map(({ name, avgTime }, index) => ({
      rank: index + 1,
      name,
      avgTime: avgTime.toFixed(2) + 'ms',
      speedRatio: index === 0 ? '1.00x' : (avgTime / validResults[0].avgTime).toFixed(2) + 'x'
    }));

    if (validResults.length > 0) {
      comparisonResults.winner = validResults[0].name;
    }

    this.printComparison(comparisonResults);
    this.results[name] = comparisonResults;
    
    return comparisonResults;
  }

  /**
   * Print comparison results
   */
  printComparison(comparison) {
    console.log(`\n🏆 Comparison Results: ${comparison.name}`);
    console.log('   Rankings (by average time):');
    
    comparison.rankings.forEach(({ rank, name, avgTime, speedRatio }) => {
      const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
      console.log(`   ${emoji} ${rank}. ${name}: ${avgTime} (${speedRatio})`);
    });

    if (comparison.winner) {
      console.log(`\n🎯 Winner: ${comparison.winner}`);
    }
  }

  /**
   * Save results to JSON file
   */
  async saveResults(filename = 'benchmark-results.json') {
    const filePath = path.join(this.options.outputDir, filename);
    const data = {
      timestamp: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        bun: typeof globalThis.Bun !== 'undefined' ? globalThis.Bun.version : null
      },
      results: this.results
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`\n💾 Results saved to: ${filePath}`);
    return filePath;
  }

  /**
   * Generate HTML report
   */
  async generateHTMLReport(filename = 'benchmark-report.html') {
    const filePath = path.join(this.options.outputDir, filename);
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>command-stream Benchmark Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f8f9fa; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .comparison { margin: 20px 0; }
        .ranking { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .winner { background: #d4edda; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: 600; }
        .metric { font-family: 'Monaco', 'Consolas', monospace; }
        .timestamp { color: #6c757d; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏁 command-stream Benchmark Report</h1>
        <p class="timestamp">Generated: ${new Date().toISOString()}</p>
        
        <h2>Environment</h2>
        <ul>
            <li><strong>Node.js:</strong> ${process.version}</li>
            <li><strong>Platform:</strong> ${process.platform} ${process.arch}</li>
            <li><strong>Bun:</strong> ${typeof globalThis.Bun !== 'undefined' ? globalThis.Bun.version : 'Not available'}</li>
        </ul>

        ${Object.values(this.results).map(comparison => `
        <div class="comparison">
            <h2>${comparison.name}</h2>
            ${comparison.winner ? `<p><strong>🏆 Winner:</strong> ${comparison.winner}</p>` : ''}
            
            <div class="rankings">
                ${comparison.rankings.map(rank => `
                <div class="ranking ${rank.rank === 1 ? 'winner' : ''}">
                    <strong>${rank.rank === 1 ? '🥇' : rank.rank === 2 ? '🥈' : rank.rank === 3 ? '🥉' : ''} 
                    ${rank.rank}. ${rank.name}</strong><br>
                    Average: <span class="metric">${rank.avgTime}</span> 
                    (${rank.speedRatio})
                </div>
                `).join('')}
            </div>
        </div>
        `).join('')}
    </div>
</body>
</html>`;

    await fs.promises.writeFile(filePath, html);
    console.log(`\n📊 HTML report generated: ${filePath}`);
    return filePath;
  }
}

export default BenchmarkRunner;