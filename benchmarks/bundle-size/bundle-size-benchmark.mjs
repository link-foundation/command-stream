#!/usr/bin/env node

/**
 * Bundle Size Benchmark
 * Compares bundle sizes of command-stream vs competitors
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class BundleSizeBenchmark {
  constructor() {
    this.results = {};
    this.tempDir = path.join(__dirname, '../temp');
    this.resultsDir = path.join(__dirname, '../results');
    
    // Ensure directories exist
    [this.tempDir, this.resultsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Get package size from npm registry
   */
  async getPackageSize(packageName) {
    try {
      console.log(`📦 Analyzing ${packageName}...`);
      
      // Get package info from npm
      const packageInfo = JSON.parse(
        execSync(`npm view ${packageName} --json`, { encoding: 'utf-8' })
      );
      
      // Create a temporary package.json and install the package
      const testDir = path.join(this.tempDir, `test-${packageName.replace('/', '-')}`);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
      
      const packageJson = {
        name: 'bundle-size-test',
        version: '1.0.0',
        private: true,
        dependencies: {
          [packageName]: packageInfo.version
        }
      };
      
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
      
      // Install the package
      execSync('npm install --production --silent', { 
        cwd: testDir, 
        stdio: 'pipe' 
      });
      
      // Calculate installed size
      const nodeModulesPath = path.join(testDir, 'node_modules', packageName);
      const installedSize = this.getDirectorySize(nodeModulesPath);
      
      // Get gzipped size estimate (simplified)
      const mainFile = packageInfo.main || 'index.js';
      let gzippedSize = 0;
      
      try {
        const mainPath = path.join(nodeModulesPath, mainFile);
        if (fs.existsSync(mainPath)) {
          const content = fs.readFileSync(mainPath, 'utf-8');
          // Rough gzip estimate: ~30% compression ratio
          gzippedSize = Math.floor(Buffer.byteLength(content) * 0.7);
        }
      } catch (error) {
        console.warn(`Could not estimate gzipped size for ${packageName}:`, error.message);
      }
      
      const result = {
        name: packageName,
        version: packageInfo.version,
        installedSize,
        gzippedSizeEstimate: gzippedSize,
        tarballSize: packageInfo.dist?.unpackedSize || 0,
        dependencies: Object.keys(packageInfo.dependencies || {}).length,
        weeklyDownloads: packageInfo['dist-tags'] ? 'N/A' : 'N/A' // Would need separate API call
      };
      
      // Cleanup
      fs.rmSync(testDir, { recursive: true, force: true });
      
      return result;
      
    } catch (error) {
      console.error(`❌ Failed to analyze ${packageName}:`, error.message);
      return {
        name: packageName,
        error: error.message,
        installedSize: 0,
        gzippedSizeEstimate: 0
      };
    }
  }

  /**
   * Get command-stream size (local package)
   */
  getCommandStreamSize() {
    const srcDir = path.join(__dirname, '../../src');
    const packageJsonPath = path.join(__dirname, '../../package.json');
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const srcSize = this.getDirectorySize(srcDir);
    
    // Estimate gzipped size
    let totalContent = '';
    const files = fs.readdirSync(srcDir);
    files.forEach(file => {
      if (file.endsWith('.mjs')) {
        totalContent += fs.readFileSync(path.join(srcDir, file), 'utf-8');
      }
    });
    
    const gzippedEstimate = Math.floor(Buffer.byteLength(totalContent) * 0.7);
    
    return {
      name: 'command-stream',
      version: packageJson.version,
      installedSize: srcSize,
      gzippedSizeEstimate: gzippedEstimate,
      dependencies: Object.keys(packageJson.dependencies || {}).length,
      isLocal: true
    };
  }

  /**
   * Calculate directory size recursively
   */
  getDirectorySize(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    
    let totalSize = 0;
    
    const traverse = (currentPath) => {
      const stats = fs.statSync(currentPath);
      
      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        const files = fs.readdirSync(currentPath);
        files.forEach(file => {
          traverse(path.join(currentPath, file));
        });
      }
    };
    
    traverse(dirPath);
    return totalSize;
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Run complete bundle size comparison
   */
  async runComparison() {
    console.log('📊 Starting Bundle Size Comparison');
    console.log('=====================================\n');

    const packages = [
      'execa',
      'cross-spawn', 
      'shelljs',
      'zx'
      // Note: Bun.$ is built-in, so it has 0KB bundle size
    ];

    // Get command-stream size first
    console.log('🔍 Analyzing command-stream (local)...');
    this.results['command-stream'] = this.getCommandStreamSize();

    // Analyze competitor packages
    for (const pkg of packages) {
      this.results[pkg] = await this.getPackageSize(pkg);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
    }

    // Add Bun.$ (built-in)
    this.results['Bun.$'] = {
      name: 'Bun.$',
      version: 'built-in',
      installedSize: 0,
      gzippedSizeEstimate: 0,
      dependencies: 0,
      isBuiltIn: true
    };

    this.printResults();
    await this.saveResults();
    await this.generateChart();

    return this.results;
  }

  /**
   * Print comparison results
   */
  printResults() {
    console.log('\n📋 Bundle Size Comparison Results');
    console.log('==================================\n');

    const validResults = Object.values(this.results)
      .filter(r => !r.error)
      .sort((a, b) => a.gzippedSizeEstimate - b.gzippedSizeEstimate);

    console.log('Ranking by estimated gzipped size:');
    console.log('-'.repeat(60));

    validResults.forEach((result, index) => {
      const rank = index + 1;
      const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
      const isBuiltIn = result.isBuiltIn ? ' (built-in)' : '';
      const isLocal = result.isLocal ? ' (current)' : '';
      
      console.log(`${emoji} ${rank}. ${result.name}${isBuiltIn}${isLocal}`);
      console.log(`   Version: ${result.version}`);
      console.log(`   Installed: ${this.formatBytes(result.installedSize)}`);
      console.log(`   Gzipped Est.: ${this.formatBytes(result.gzippedSizeEstimate)}`);
      console.log(`   Dependencies: ${result.dependencies || 0}`);
      console.log('');
    });

    // Show errors
    const errors = Object.values(this.results).filter(r => r.error);
    if (errors.length > 0) {
      console.log('❌ Failed to analyze:');
      errors.forEach(r => {
        console.log(`   ${r.name}: ${r.error}`);
      });
    }
  }

  /**
   * Save results to JSON
   */
  async saveResults() {
    const resultsPath = path.join(this.resultsDir, 'bundle-size-results.json');
    const data = {
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: {
        fastest: Object.values(this.results)
          .filter(r => !r.error)
          .sort((a, b) => a.gzippedSizeEstimate - b.gzippedSizeEstimate)[0]?.name
      }
    };

    await fs.promises.writeFile(resultsPath, JSON.stringify(data, null, 2));
    console.log(`💾 Bundle size results saved to: ${resultsPath}`);
  }

  /**
   * Generate simple text chart
   */
  async generateChart() {
    const chartPath = path.join(this.resultsDir, 'bundle-size-chart.txt');
    
    const validResults = Object.values(this.results)
      .filter(r => !r.error && r.gzippedSizeEstimate > 0)
      .sort((a, b) => a.gzippedSizeEstimate - b.gzippedSizeEstimate);

    if (validResults.length === 0) return;

    const maxSize = Math.max(...validResults.map(r => r.gzippedSizeEstimate));
    const maxNameLength = Math.max(...validResults.map(r => r.name.length));

    let chart = 'Bundle Size Comparison (Gzipped Estimate)\n';
    chart += '='.repeat(50) + '\n\n';

    validResults.forEach(result => {
      const barLength = Math.max(1, Math.floor((result.gzippedSizeEstimate / maxSize) * 40));
      const bar = '█'.repeat(barLength);
      const name = result.name.padEnd(maxNameLength);
      const size = this.formatBytes(result.gzippedSizeEstimate);
      
      chart += `${name} │${bar} ${size}\n`;
    });

    chart += '\nBun.$ (built-in): 0 KB - No bundle size impact\n';

    await fs.promises.writeFile(chartPath, chart);
    console.log(`📊 Bundle size chart saved to: ${chartPath}`);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const benchmark = new BundleSizeBenchmark();
  benchmark.runComparison().catch(console.error);
}

export default BundleSizeBenchmark;