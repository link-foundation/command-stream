#!/usr/bin/env node

/**
 * Quick Benchmark Demo
 * Runs a fast subset of benchmarks for demonstrations and quick validation
 */

import { $ } from '../src/$.mjs';
import { BenchmarkRunner } from './lib/benchmark-runner.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runQuickDemo() {
  console.log('🚀 command-stream Quick Benchmark Demo');
  console.log('======================================\n');
  console.log('Running a fast subset of benchmarks to showcase key capabilities...\n');

  const runner = new BenchmarkRunner({
    iterations: 25,
    warmup: 3,
    outputDir: path.join(__dirname, 'results')
  });

  try {
    // 1. Basic Performance Demo
    console.log('⚡ Performance Demo: Basic Command Execution');
    const basicPerf = await runner.runComparison(
      'Basic Commands',
      {
        'await-pattern': async () => {
          const result = await $`echo "Hello World"`;
          return result.stdout.length;
        },
        
        'streaming-pattern': async () => {
          let totalLength = 0;
          for await (const chunk of $`echo "Hello World"`.stream()) {
            totalLength += chunk.length;
          }
          return totalLength;
        },

        'event-pattern': async () => {
          return new Promise((resolve) => {
            let output = '';
            $`echo "Hello World"`
              .on('data', chunk => { output += chunk; })
              .on('end', () => resolve(output.length));
          });
        }
      },
      { iterations: 50, warmup: 5 }
    );

    // 2. Feature Demo
    console.log('\n🧪 Feature Demo: Core Capabilities');
    const features = [
      {
        name: 'Template Literals',
        test: async () => {
          const word = 'interpolation';
          const result = await $`echo ${word}`;
          return result.stdout.trim() === 'interpolation';
        }
      },
      {
        name: 'Async Iteration', 
        test: async () => {
          let chunks = 0;
          for await (const chunk of $`echo -e "line1\\nline2"`.stream()) {
            chunks++;
          }
          return chunks > 0;
        }
      },
      {
        name: 'Event Handling',
        test: async () => {
          return new Promise((resolve) => {
            let gotData = false;
            $`echo "events"`
              .on('data', () => { gotData = true; })
              .on('end', () => resolve(gotData));
          });
        }
      },
      {
        name: 'Error Handling',
        test: async () => {
          try {
            await $`exit 42`;
            return false;
          } catch (error) {
            return error.code === 42;
          }
        }
      }
    ];

    const featureResults = [];
    for (const { name, test } of features) {
      try {
        const success = await test();
        featureResults.push({ name, status: success ? 'PASS' : 'FAIL' });
        console.log(`   ${success ? '✅' : '❌'} ${name}`);
      } catch (error) {
        featureResults.push({ name, status: 'ERROR', error: error.message });
        console.log(`   ❌ ${name}: ${error.message}`);
      }
    }

    // 3. Bundle Size Demo
    console.log('\n📦 Bundle Size Demo');
    const srcDir = path.join(__dirname, '../src');
    let totalSize = 0;
    let fileCount = 0;

    const measureDir = (dir) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stats = fs.statSync(itemPath);
        if (stats.isFile() && item.endsWith('.mjs')) {
          totalSize += stats.size;
          fileCount++;
        } else if (stats.isDirectory()) {
          measureDir(itemPath);
        }
      }
    };

    measureDir(srcDir);

    const gzipEstimate = Math.floor(totalSize * 0.7); // Rough gzip estimate
    console.log(`   📁 Source files: ${fileCount} files`);
    console.log(`   📏 Total size: ${(totalSize / 1024).toFixed(1)}KB`);
    console.log(`   🗜️  Gzipped estimate: ${(gzipEstimate / 1024).toFixed(1)}KB`);

    // 4. Real-world Demo
    console.log('\n🌍 Real-world Demo: File Processing');
    const fileProcessing = await runner.runComparison(
      'File Operations',
      {
        'find-and-count': async () => {
          const result = await $`find ${srcDir} -name "*.mjs" | wc -l`;
          return parseInt(result.stdout.trim());
        },

        'streaming-find': async () => {
          let count = 0;
          for await (const chunk of $`find ${srcDir} -name "*.mjs"`.stream()) {
            count += chunk.split('\n').filter(line => line.trim()).length;
          }
          return count;
        },

        'pipeline-processing': async () => {
          const result = await $`find ${srcDir} -name "*.mjs" | head -5 | wc -l`;
          return parseInt(result.stdout.trim());
        }
      },
      { iterations: 20, warmup: 2 }
    );

    // 5. Generate Summary
    console.log('\n📊 Quick Demo Summary');
    console.log('====================');
    
    const passed = featureResults.filter(f => f.status === 'PASS').length;
    const total = featureResults.length;
    
    console.log(`✅ Features Working: ${passed}/${total} (${((passed/total)*100).toFixed(1)}%)`);
    console.log(`📦 Bundle Size: ~${(gzipEstimate / 1024).toFixed(1)}KB gzipped`);
    console.log(`⚡ Performance: Multiple execution patterns benchmarked`);
    console.log(`🌍 Real-world: File operations tested`);

    console.log('\n🏆 Key Takeaways:');
    console.log('• command-stream supports multiple usage patterns (await, streaming, events)');
    console.log('• Small bundle size with zero dependencies');
    console.log('• Real-time streaming capabilities for memory efficiency');
    console.log('• Cross-platform compatibility with built-in commands');
    console.log('• Production-ready error handling and signal management');

    console.log('\n📋 Run full benchmarks with:');
    console.log('   npm run benchmark           # Complete suite');
    console.log('   npm run benchmark:quick     # Skip slow benchmarks');
    console.log('   npm run benchmark:features  # Feature tests only');

    // Save demo results
    const demoResults = {
      timestamp: new Date().toISOString(),
      features: featureResults,
      bundleSize: {
        files: fileCount,
        totalBytes: totalSize,
        gzippedEstimate: gzipEstimate
      },
      performance: {
        basicExecution: basicPerf.rankings,
        fileProcessing: fileProcessing.rankings
      }
    };

    const resultsPath = path.join(__dirname, 'results', 'quick-demo-results.json');
    await fs.promises.writeFile(resultsPath, JSON.stringify(demoResults, null, 2));
    console.log(`\n💾 Demo results saved: ${resultsPath}`);

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runQuickDemo()
    .then(() => {
      console.log('\n✅ Quick demo completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Quick demo failed:', error);
      process.exit(1);
    });
}

export default runQuickDemo;