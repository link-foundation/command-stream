#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Enable virtual commands including cd
enableVirtualCommands();
shell.verbose(true);

console.log('=== GitHub CLI Operations with cd Virtual Command Examples ===\n');

async function example1_CheckGHAuth() {
  console.log('Example 1: Check GitHub CLI Authentication\n');
  
  try {
    // Check auth status
    const authStatus = await $`gh auth status 2>&1 || echo "Not authenticated"`;
    
    // Try to get current user
    const user = await $`gh api user --jq .login 2>/dev/null || echo "anonymous"`;
    console.log(`Current user: ${user.stdout.trim()}`);
    
    // Check gh version
    const version = await $`gh --version`;
    console.log(`GitHub CLI version: ${version.stdout.split('\n')[0]}`);
    
    console.log('✓ GitHub CLI check completed\n');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function example2_SimulateRepoClone() {
  console.log('Example 2: Simulate Repository Clone Pattern\n');
  
  const tempDir = mkdtempSync(join(tmpdir(), 'gh-clone-'));
  const originalCwd = process.cwd();
  
  try {
    // This simulates the pattern from solve.mjs
    const owner = 'octocat';
    const repo = 'Hello-World';
    
    console.log(`Simulating clone of ${owner}/${repo} to ${tempDir}`);
    
    // Navigate to temp directory
    await $`cd ${tempDir}`;
    
    // In real scenario, this would clone the repo
    // For example purposes, we'll create a mock structure
    await $`git init`;
    await $`git config user.email "bot@example.com"`;
    await $`git config user.name "Bot"`;
    await $`echo "# ${repo}" > README.md`;
    await $`git add . && git commit -m "Initial commit"`;
    
    // Simulate gh commands that would work in a cloned repo
    console.log('\nSimulating gh pr list (would fail without remote):');
    await $`gh pr list --limit 1 2>&1 || echo "No remote repository"`;
    
    // Return to original directory
    await $`cd ${originalCwd}`;
    
    console.log('✓ Clone pattern simulation completed\n');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function example3_WorkflowWithTempDir() {
  console.log('Example 3: Complete Workflow in Temp Directory\n');
  
  const tempDir = mkdtempSync(join(tmpdir(), 'workflow-'));
  const originalCwd = process.cwd();
  
  try {
    // Step 1: Setup repository
    console.log('Step 1: Initialize repository');
    await $`cd ${tempDir} && git init`;
    await $`cd ${tempDir} && git config user.email "workflow@example.com"`;
    await $`cd ${tempDir} && git config user.name "Workflow Bot"`;
    
    // Step 2: Create initial structure
    console.log('\nStep 2: Create project structure');
    await $`cd ${tempDir} && mkdir -p src tests docs`;
    await $`cd ${tempDir} && echo "# Project" > README.md`;
    await $`cd ${tempDir} && echo "console.log('Hello');" > src/index.js`;
    await $`cd ${tempDir} && echo "test('example', () => {});" > tests/test.js`;
    
    // Step 3: Initial commit
    console.log('\nStep 3: Create initial commit');
    await $`cd ${tempDir} && git add .`;
    await $`cd ${tempDir} && git commit -m "Initial project structure"`;
    
    // Step 4: Create feature branch
    console.log('\nStep 4: Create feature branch');
    const branchName = `feature-${Date.now()}`;
    await $`cd ${tempDir} && git checkout -b ${branchName}`;
    
    // Step 5: Make feature changes
    console.log('\nStep 5: Implement feature');
    await $`cd ${tempDir} && echo "export const feature = () => 'new feature';" > src/feature.js`;
    await $`cd ${tempDir} && git add .`;
    await $`cd ${tempDir} && git commit -m "Add new feature"`;
    
    // Step 6: Show repository state
    console.log('\nStep 6: Show repository state');
    await $`cd ${tempDir} && git log --oneline --graph --all`;
    await $`cd ${tempDir} && git status`;
    
    // Return to original directory
    await $`cd ${originalCwd}`;
    
    console.log('\n✓ Workflow completed successfully\n');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function example4_MultipleDirectoryOperations() {
  console.log('Example 4: Multiple Directory Operations\n');
  
  const baseDir = mkdtempSync(join(tmpdir(), 'multi-'));
  const project1 = join(baseDir, 'project1');
  const project2 = join(baseDir, 'project2');
  const originalCwd = process.cwd();
  
  try {
    // Create project directories
    await $`mkdir -p ${project1} ${project2}`;
    
    // Initialize project 1
    console.log('Setting up project1:');
    await $`cd ${project1} && git init && echo "Project 1" > README.md`;
    await $`cd ${project1} && git add . && git config user.email "p1@test.com"`;
    await $`cd ${project1} && git commit -m "Project 1 init" 2>/dev/null || echo "Commit created"`;
    
    // Initialize project 2
    console.log('\nSetting up project2:');
    await $`cd ${project2} && git init && echo "Project 2" > README.md`;
    await $`cd ${project2} && git add . && git config user.email "p2@test.com"`;
    await $`cd ${project2} && git commit -m "Project 2 init" 2>/dev/null || echo "Commit created"`;
    
    // Show both project states
    console.log('\nProject 1 status:');
    await $`cd ${project1} && git log --oneline`;
    
    console.log('\nProject 2 status:');
    await $`cd ${project2} && git log --oneline`;
    
    // Demonstrate that cd doesn't affect parent shell
    const pwdResult = await $`pwd`;
    console.log(`\nCurrent directory (unchanged): ${pwdResult.stdout.trim()}`);
    
    await $`cd ${originalCwd}`;
    
    console.log('\n✓ Multiple directory operations completed\n');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

// Run all examples
async function runExamples() {
  try {
    await example1_CheckGHAuth();
    await example2_SimulateRepoClone();
    await example3_WorkflowWithTempDir();
    await example4_MultipleDirectoryOperations();
    
    console.log('=== All GitHub CLI Examples Completed ===');
  } catch (error) {
    console.error('Failed to run examples:', error);
    process.exit(1);
  }
}

runExamples();