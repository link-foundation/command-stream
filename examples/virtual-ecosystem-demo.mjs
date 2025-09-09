#!/usr/bin/env bun
import { $ } from '../src/$.mjs';

console.log('🚀 Virtual Commands Ecosystem Demo\n');

// 1. Package Installation
console.log('📦 Installing command packages...');
const gitToolsResult = await $.install('@command-stream/git-tools');
console.log(`✅ ${gitToolsResult.message}`);
console.log(`   Commands: ${gitToolsResult.commands.join(', ')}\n`);

const fileToolsResult = await $.install('@command-stream/file-tools');
console.log(`✅ ${fileToolsResult.message}`);
console.log(`   Commands: ${fileToolsResult.commands.join(', ')}\n`);

// 2. Using installed commands
console.log('🔧 Using installed commands...');
const gitStatus = await $`git-status-clean`;
console.log(`Git Status: ${gitStatus.stdout.trim()}`);

const enhancedLs = await $`enhanced-ls`;
console.log(`Enhanced LS:\n${enhancedLs.stdout}`);

// 3. Creating custom commands
console.log('⚡ Creating custom commands...');
$.create('welcome', async ({ args }) => {
  const name = args[0] || 'Developer';
  const message = `🎉 Welcome to command-stream, ${name}!\n`;
  return { stdout: message, stderr: '', code: 0 };
});

const welcome = await $`welcome Alice`;
console.log(welcome.stdout.trim());

// 4. Creating streaming command
$.create('countdown', async function* ({ args }) {
  const count = parseInt(args[0]) || 5;
  for (let i = count; i >= 1; i--) {
    yield `⏰ ${i}...\n`;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  yield `🎯 Launch!\n`;
}, { streaming: true });

console.log('\n🚀 Countdown demo:');
const countdownResult = await $`countdown 3`;
console.log(countdownResult.stdout);

// 5. Command extension with middleware
console.log('🔧 Extending commands with middleware...');
$.extend('welcome', async (result, context) => {
  return {
    ...result,
    stdout: `[🌟 ENHANCED] ${result.stdout}`
  };
});

const enhancedWelcome = await $`welcome Bob`;
console.log(enhancedWelcome.stdout.trim());

// 6. Command composition
console.log('\n🔗 Command composition demo...');
$.create('gen-data', async ({ args }) => {
  const items = ['apple', 'banana', 'cherry'];
  return { stdout: items.join('\n') + '\n', stderr: '', code: 0 };
});

$.create('format-data', async ({ stdin }) => {
  const formatted = (stdin || '').split('\n')
    .filter(line => line.trim())
    .map((item, i) => `${i + 1}. 🍎 ${item}`)
    .join('\n');
  return { stdout: formatted + '\n', stderr: '', code: 0 };
});

$.compose('fruit-list', ['gen-data', 'format-data'], { mode: 'pipeline' });

const fruitList = await $`fruit-list`;
console.log('Fruit List:');
console.log(fruitList.stdout);

// 7. Marketplace demonstration
console.log('🛒 Marketplace features...');
const searchResults = await $.marketplace.search('git');
console.log('Search results for "git":');
searchResults.results.forEach(pkg => {
  console.log(`  📦 ${pkg.name} v${pkg.version} (${pkg.downloads} downloads, ⭐${pkg.rating})`);
  console.log(`     ${pkg.description}`);
  console.log(`     Commands: ${pkg.commands.join(', ')}\n`);
});

const packageInfo = await $.marketplace.info('@command-stream/git-tools');
console.log('Package info for git-tools:');
console.log(`  Name: ${packageInfo.name}`);
console.log(`  Version: ${packageInfo.version}`);
console.log(`  Commands: ${packageInfo.commands.join(', ')}`);
console.log(`  Installed: ${packageInfo.installed ? '✅' : '❌'}`);

const installedPackages = $.marketplace.list();
console.log(`\n📋 Installed packages (${installedPackages.length}):`);
installedPackages.forEach(pkg => {
  console.log(`  📦 ${pkg.name} v${pkg.version} - ${pkg.commands.length} commands`);
});

console.log('\n🎉 Virtual Commands Ecosystem Demo Complete!');
console.log('🔥 No competitor can match this extensible shell environment!');