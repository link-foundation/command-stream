#!/usr/bin/env bun
import { $ } from '../src/$.mjs';

console.log('🏢 Enterprise Virtual Commands Demo\n');

// Install deployment tools
console.log('📦 Installing enterprise deployment tools...');
const deployResult = await $.install('@command-stream/deploy-tools');
console.log(`✅ ${deployResult.message}\n`);

// Create enterprise-specific custom commands
console.log('🔧 Creating enterprise custom commands...\n');

// 1. Environment validation command
$.create('validate-env', async ({ args }) => {
  const env = args[0] || 'development';
  const validEnvs = ['development', 'staging', 'production'];
  
  if (!validEnvs.includes(env)) {
    return { 
      stdout: '', 
      stderr: `❌ Invalid environment: ${env}. Valid options: ${validEnvs.join(', ')}\n`, 
      code: 1 
    };
  }
  
  return { 
    stdout: `✅ Environment '${env}' is valid\n`, 
    stderr: '', 
    code: 0 
  };
});

// 2. Security check command
$.create('security-check', async ({ args }) => {
  const checks = [
    'Checking for secrets in code...',
    'Validating SSL certificates...',
    'Scanning for vulnerabilities...',
    'Verifying access controls...'
  ];
  
  let output = '🔒 Running security checks:\n';
  for (const check of checks) {
    output += `   ${check} ✅\n`;
  }
  output += '🛡️ All security checks passed!\n';
  
  return { stdout: output, stderr: '', code: 0 };
});

// 3. Performance monitoring command
$.create('perf-monitor', async function* ({ args }) {
  const duration = parseInt(args[0]) || 3;
  yield '📊 Starting performance monitoring...\n';
  
  for (let i = 1; i <= duration; i++) {
    const cpu = Math.round(Math.random() * 100);
    const memory = Math.round(Math.random() * 8000);
    yield `[${i}s] CPU: ${cpu}%, Memory: ${memory}MB\n`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  yield '📈 Performance monitoring complete!\n';
}, { streaming: true });

// Create deployment pipeline with middleware
console.log('🚀 Setting up deployment pipeline...\n');

// Extend deploy command with validation middleware
$.extend('deploy', {
  pre: async (context) => {
    console.log('🔍 Pre-deployment validation...');
    const env = context.args[0] || 'staging';
    
    // Run validation
    const validation = await $`validate-env ${env}`;
    if (validation.code !== 0) {
      throw new Error(`Validation failed: ${validation.stderr}`);
    }
    
    // Run security check
    const security = await $`security-check`;
    if (security.code !== 0) {
      throw new Error(`Security check failed: ${security.stderr}`);
    }
    
    console.log('✅ Pre-deployment checks passed');
    return context;
  },
  post: async (result, context) => {
    if (result.code === 0) {
      console.log('🎉 Post-deployment: Notifying team...');
      result.stdout += '\n📧 Team notification sent!\n';
    }
    return result;
  }
});

// Create comprehensive deployment command composition
$.compose('full-deploy', [
  'validate-env',
  'security-check', 
  'deploy'
], { 
  mode: 'sequence',
  continueOnError: false 
});

// Create monitoring pipeline
$.compose('deploy-with-monitoring', [
  'full-deploy',
  'perf-monitor'
], {
  mode: 'sequence'
});

// Demonstrate enterprise workflow
console.log('🏢 Enterprise Deployment Workflow Demo:\n');

try {
  // Test environment validation
  console.log('1️⃣ Testing environment validation...');
  const validationTest = await $`validate-env production`;
  console.log(validationTest.stdout);
  
  // Test security check
  console.log('2️⃣ Running security checks...');
  const securityTest = await $`security-check`;
  console.log(securityTest.stdout);
  
  // Test performance monitoring
  console.log('3️⃣ Performance monitoring (3 seconds)...');
  const perfTest = await $`perf-monitor 3`;
  console.log(perfTest.stdout);
  
  // Full deployment with validation and monitoring
  console.log('4️⃣ Full deployment pipeline...');
  const deployTest = await $`deploy production`;
  console.log(deployTest.stdout);
  
  console.log('\n✨ Enterprise deployment completed successfully!');
  
} catch (error) {
  console.error('❌ Deployment failed:', error.message);
}

// Create development helper commands
console.log('\n🛠️ Development Helper Commands:\n');

$.create('db-migrate', async ({ args }) => {
  const direction = args[0] || 'up';
  return { 
    stdout: `🗄️ Running database migration (${direction})...\n✅ Migration complete!\n`, 
    stderr: '', 
    code: 0 
  };
});

$.create('test-suite', async ({ args }) => {
  const suite = args[0] || 'all';
  const testCounts = { unit: 245, integration: 67, e2e: 23 };
  let output = `🧪 Running ${suite} tests...\n`;
  
  if (suite === 'all') {
    Object.entries(testCounts).forEach(([type, count]) => {
      output += `   ${type}: ${count} tests ✅\n`;
    });
  } else if (testCounts[suite]) {
    output += `   ${suite}: ${testCounts[suite]} tests ✅\n`;
  }
  
  output += '🎯 All tests passed!\n';
  return { stdout: output, stderr: '', code: 0 };
});

$.create('build-assets', async ({ args }) => {
  const env = args[0] || 'development';
  return { 
    stdout: `📦 Building assets for ${env}...\n🏗️ Webpack bundling complete!\n✨ Assets optimized!\n`, 
    stderr: '', 
    code: 0 
  };
});

// Create complete CI/CD pipeline
$.compose('ci-pipeline', [
  'test-suite',
  'build-assets',
  'security-check',
  'validate-env'
], {
  mode: 'sequence'
});

$.compose('cd-pipeline', [
  'ci-pipeline',
  'db-migrate',
  'deploy'
], {
  mode: 'sequence'
});

console.log('5️⃣ Testing CI/CD pipeline...');
const cicdTest = await $`ci-pipeline`;
console.log(cicdTest.stdout);

// Show marketplace packages for enterprise
console.log('\n🛒 Enterprise Package Recommendations:\n');
const enterpriseSearch = await $.marketplace.search('deploy');
enterpriseSearch.results.forEach(pkg => {
  console.log(`📦 ${pkg.name} - ${pkg.description}`);
  console.log(`   ⭐ Rating: ${pkg.rating}/5.0 | 📈 Downloads: ${pkg.downloads}`);
  console.log(`   🔧 Commands: ${pkg.commands.join(', ')}\n`);
});

console.log('🚀 Enterprise Virtual Commands Demo Complete!');
console.log('💼 Ready for production deployment workflows!');