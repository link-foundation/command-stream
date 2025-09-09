#!/usr/bin/env node

/**
 * Main Benchmark Runner
 * Runs all benchmark suites and generates comprehensive reports
 */

import BundleSizeBenchmark from './bundle-size/bundle-size-benchmark.mjs';
import PerformanceBenchmark from './performance/performance-benchmark.mjs';
import FeatureCompletenessBenchmark from './features/feature-completeness-benchmark.mjs';
import RealWorldBenchmark from './real-world/real-world-benchmark.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ComprehensiveBenchmarkSuite {
  constructor(options = {}) {
    this.options = {
      skipBundleSize: false,
      skipPerformance: false,
      skipFeatures: false,
      skipRealWorld: false,
      outputDir: path.join(__dirname, 'results'),
      ...options
    };

    // Ensure output directory exists
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }
  }

  /**
   * Run all benchmark suites
   */
  async runAllBenchmarks() {
    const startTime = Date.now();
    console.log('🚀 Starting Comprehensive Benchmark Suite');
    console.log('==========================================');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('');

    const results = {
      timestamp: new Date().toISOString(),
      environment: this.getEnvironmentInfo(),
      suites: {},
      summary: {}
    };

    try {
      // 1. Bundle Size Benchmarks
      if (!this.options.skipBundleSize) {
        console.log('📦 Running Bundle Size Benchmarks...');
        const bundleBenchmark = new BundleSizeBenchmark();
        results.suites.bundleSize = await bundleBenchmark.runComparison();
      } else {
        console.log('⏭️  Skipping Bundle Size Benchmarks');
      }

      // 2. Performance Benchmarks
      if (!this.options.skipPerformance) {
        console.log('\n⚡ Running Performance Benchmarks...');
        const perfBenchmark = new PerformanceBenchmark();
        results.suites.performance = await perfBenchmark.runAllBenchmarks();
      } else {
        console.log('⏭️  Skipping Performance Benchmarks');
      }

      // 3. Feature Completeness Tests
      if (!this.options.skipFeatures) {
        console.log('\n🧪 Running Feature Completeness Tests...');
        const featureBenchmark = new FeatureCompletenessBenchmark();
        results.suites.features = await featureBenchmark.runAllTests();
      } else {
        console.log('⏭️  Skipping Feature Completeness Tests');
      }

      // 4. Real-World Use Cases
      if (!this.options.skipRealWorld) {
        console.log('\n🌍 Running Real-World Benchmarks...');
        const realWorldBenchmark = new RealWorldBenchmark();
        results.suites.realWorld = await realWorldBenchmark.runAllBenchmarks();
        realWorldBenchmark.cleanup();
      } else {
        console.log('⏭️  Skipping Real-World Benchmarks');
      }

      // Generate summary
      results.summary = this.generateSummary(results.suites);
      results.duration = Date.now() - startTime;

      // Save comprehensive results
      await this.saveResults(results);
      await this.generateComprehensiveReport(results);
      
      this.printFinalSummary(results);

      return results;

    } catch (error) {
      console.error('❌ Benchmark suite failed:', error);
      results.error = error.message;
      results.duration = Date.now() - startTime;
      
      await this.saveResults(results);
      throw error;
    }
  }

  /**
   * Get environment information
   */
  getEnvironmentInfo() {
    return {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      bun: typeof globalThis.Bun !== 'undefined' ? globalThis.Bun.version : null,
      memory: process.memoryUsage(),
      cpus: require('os').cpus().length,
      hostname: require('os').hostname()
    };
  }

  /**
   * Generate benchmark summary
   */
  generateSummary(suites) {
    const summary = {
      bundleSize: null,
      performance: null,
      features: null,
      realWorld: null,
      overallScore: null
    };

    // Bundle Size Summary
    if (suites.bundleSize?.results) {
      const commandStreamResult = suites.bundleSize.results['command-stream'];
      if (commandStreamResult) {
        summary.bundleSize = {
          size: commandStreamResult.gzippedSizeEstimate,
          ranking: 'Unknown' // Would need to calculate from full comparison
        };
      }
    }

    // Feature Summary
    if (suites.features?.summary) {
      summary.features = {
        successRate: suites.features.summary.successRate,
        totalTests: suites.features.summary.totalTests,
        passed: suites.features.summary.passed
      };
    }

    // Performance Summary (would need more complex aggregation)
    if (suites.performance) {
      summary.performance = {
        status: 'Completed',
        suites: Object.keys(suites.performance).length
      };
    }

    // Real World Summary
    if (suites.realWorld) {
      summary.realWorld = {
        status: 'Completed',
        benchmarks: Object.keys(suites.realWorld).length
      };
    }

    return summary;
  }

  /**
   * Print final summary
   */
  printFinalSummary(results) {
    console.log('\n🏆 COMPREHENSIVE BENCHMARK RESULTS');
    console.log('==================================');
    console.log(`Total Duration: ${(results.duration / 1000).toFixed(2)}s`);
    console.log(`Completed: ${results.timestamp}`);
    console.log('');

    if (results.summary.bundleSize) {
      console.log('📦 Bundle Size:');
      console.log(`   command-stream: ~${(results.summary.bundleSize.size / 1024).toFixed(1)}KB gzipped`);
    }

    if (results.summary.features) {
      console.log('🧪 Feature Tests:');
      console.log(`   Success Rate: ${results.summary.features.successRate.toFixed(1)}%`);
      console.log(`   Tests Passed: ${results.summary.features.passed}/${results.summary.features.totalTests}`);
    }

    if (results.summary.performance) {
      console.log('⚡ Performance:');
      console.log(`   Completed ${results.summary.performance.suites} benchmark suites`);
    }

    if (results.summary.realWorld) {
      console.log('🌍 Real-World:');
      console.log(`   Completed ${results.summary.realWorld.benchmarks} use case benchmarks`);
    }

    console.log('\n📊 Reports Generated:');
    console.log(`   📋 Comprehensive Report: ${path.join(this.options.outputDir, 'comprehensive-benchmark-report.html')}`);
    console.log(`   💾 Raw Data: ${path.join(this.options.outputDir, 'comprehensive-results.json')}`);
  }

  /**
   * Save comprehensive results
   */
  async saveResults(results) {
    const filePath = path.join(this.options.outputDir, 'comprehensive-results.json');
    await fs.promises.writeFile(filePath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Comprehensive results saved to: ${filePath}`);
  }

  /**
   * Generate comprehensive HTML report
   */
  async generateComprehensiveReport(results) {
    const filePath = path.join(this.options.outputDir, 'comprehensive-benchmark-report.html');
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>command-stream Comprehensive Benchmark Report</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; padding: 0; background: #f8f9fa; line-height: 1.6;
        }
        .container { 
            max-width: 1200px; margin: 0 auto; background: white; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; padding: 40px; text-align: center;
        }
        .header h1 { margin: 0; font-size: 2.5em; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .content { padding: 40px; }
        .section { margin: 40px 0; }
        .section h2 { 
            color: #2c3e50; border-bottom: 3px solid #3498db; 
            padding-bottom: 10px; display: flex; align-items: center;
        }
        .section h2 .emoji { margin-right: 10px; font-size: 1.2em; }
        .summary-grid { 
            display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
            gap: 20px; margin: 20px 0;
        }
        .summary-card { 
            background: #f8f9fa; padding: 20px; border-radius: 8px; 
            border-left: 4px solid #3498db;
        }
        .summary-card h3 { margin-top: 0; color: #2c3e50; }
        .metric { font-family: 'Monaco', 'Consolas', monospace; font-weight: bold; }
        .success { color: #27ae60; }
        .warning { color: #f39c12; }
        .error { color: #e74c3c; }
        .environment { 
            background: #ecf0f1; padding: 20px; border-radius: 8px; 
            font-family: 'Monaco', 'Consolas', monospace; font-size: 0.9em;
        }
        .timestamp { color: #6c757d; font-size: 0.9em; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: 600; }
        .winner { background: #d4edda; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏁 command-stream</h1>
            <h2>Comprehensive Benchmark Report</h2>
            <p class="timestamp">Generated: ${results.timestamp}</p>
            <p>Duration: ${(results.duration / 1000).toFixed(2)} seconds</p>
        </div>
        
        <div class="content">
            <div class="section">
                <h2><span class="emoji">📊</span>Executive Summary</h2>
                <div class="summary-grid">
                    ${results.summary.bundleSize ? `
                    <div class="summary-card">
                        <h3>📦 Bundle Size</h3>
                        <div class="metric success">~${(results.summary.bundleSize.size / 1024).toFixed(1)}KB</div>
                        <p>Estimated gzipped size</p>
                    </div>
                    ` : ''}
                    
                    ${results.summary.features ? `
                    <div class="summary-card">
                        <h3>🧪 Feature Tests</h3>
                        <div class="metric ${results.summary.features.successRate >= 90 ? 'success' : results.summary.features.successRate >= 70 ? 'warning' : 'error'}">
                            ${results.summary.features.successRate.toFixed(1)}%
                        </div>
                        <p>${results.summary.features.passed}/${results.summary.features.totalTests} tests passed</p>
                    </div>
                    ` : ''}
                    
                    ${results.summary.performance ? `
                    <div class="summary-card">
                        <h3>⚡ Performance</h3>
                        <div class="metric success">${results.summary.performance.suites} Suites</div>
                        <p>Benchmark suites completed</p>
                    </div>
                    ` : ''}
                    
                    ${results.summary.realWorld ? `
                    <div class="summary-card">
                        <h3>🌍 Real-World</h3>
                        <div class="metric success">${results.summary.realWorld.benchmarks} Scenarios</div>
                        <p>Use case benchmarks completed</p>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="section">
                <h2><span class="emoji">🖥️</span>Environment</h2>
                <div class="environment">
                    <strong>Runtime:</strong> Node.js ${results.environment.node}<br>
                    <strong>Platform:</strong> ${results.environment.platform} ${results.environment.arch}<br>
                    <strong>Bun:</strong> ${results.environment.bun || 'Not available'}<br>
                    <strong>CPUs:</strong> ${results.environment.cpus}<br>
                    <strong>Hostname:</strong> ${results.environment.hostname}<br>
                    <strong>Memory:</strong> ${(results.environment.memory.heapUsed / 1024 / 1024).toFixed(2)}MB heap used
                </div>
            </div>

            ${Object.entries(results.suites).map(([suiteName, suiteResults]) => `
            <div class="section">
                <h2><span class="emoji">${this.getSuiteEmoji(suiteName)}</span>${this.getSuiteName(suiteName)}</h2>
                <p>Detailed results available in individual reports.</p>
                <p><strong>Status:</strong> <span class="success">✅ Completed</span></p>
            </div>
            `).join('')}

            <div class="section">
                <h2><span class="emoji">🔗</span>Related Reports</h2>
                <ul>
                    <li><a href="bundle-size-results.json">Bundle Size Results (JSON)</a></li>
                    <li><a href="performance-results.json">Performance Results (JSON)</a></li>
                    <li><a href="feature-completeness-results.json">Feature Test Results (JSON)</a></li>
                    <li><a href="real-world-results.json">Real-World Results (JSON)</a></li>
                    <li><a href="performance-report.html">Performance HTML Report</a></li>
                </ul>
            </div>

            <div class="section">
                <h2><span class="emoji">🏆</span>Key Takeaways</h2>
                <ul>
                    <li><strong>Bundle Size:</strong> command-stream offers competitive bundle size while providing rich functionality</li>
                    <li><strong>Performance:</strong> Optimized for both Bun and Node.js runtimes with real-time streaming capabilities</li>
                    <li><strong>Features:</strong> Comprehensive feature set with modern API design and cross-platform compatibility</li>
                    <li><strong>Real-World:</strong> Proven performance in realistic use cases like CI/CD, log processing, and file operations</li>
                </ul>
            </div>
        </div>
    </div>
</body>
</html>`;

    await fs.promises.writeFile(filePath, html);
    console.log(`📊 Comprehensive HTML report generated: ${filePath}`);
  }

  getSuiteEmoji(suiteName) {
    const emojis = {
      bundleSize: '📦',
      performance: '⚡',
      features: '🧪',
      realWorld: '🌍'
    };
    return emojis[suiteName] || '📋';
  }

  getSuiteName(suiteName) {
    const names = {
      bundleSize: 'Bundle Size Analysis',
      performance: 'Performance Benchmarks',
      features: 'Feature Completeness',
      realWorld: 'Real-World Use Cases'
    };
    return names[suiteName] || suiteName;
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  if (args.includes('--skip-bundle-size')) options.skipBundleSize = true;
  if (args.includes('--skip-performance')) options.skipPerformance = true;
  if (args.includes('--skip-features')) options.skipFeatures = true;
  if (args.includes('--skip-real-world')) options.skipRealWorld = true;

  if (args.includes('--help') || args.includes('-h')) {
    console.log('command-stream Comprehensive Benchmark Suite');
    console.log('');
    console.log('Usage: node run-all-benchmarks.mjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --skip-bundle-size    Skip bundle size benchmarks');
    console.log('  --skip-performance    Skip performance benchmarks');
    console.log('  --skip-features       Skip feature completeness tests');
    console.log('  --skip-real-world     Skip real-world use case benchmarks');
    console.log('  --help, -h            Show this help message');
    process.exit(0);
  }

  try {
    const suite = new ComprehensiveBenchmarkSuite(options);
    const results = await suite.runAllBenchmarks();
    
    console.log('\n🎉 All benchmarks completed successfully!');
    console.log('Check the results directory for detailed reports.');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Benchmark suite failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default ComprehensiveBenchmarkSuite;