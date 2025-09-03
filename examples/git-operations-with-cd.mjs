#!/usr/bin/env node

import { $, shell, enableVirtualCommands } from '../src/$.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Enable virtual commands including cd
enableVirtualCommands();
shell.verbose(true);

console.log('=== Git Operations with cd Virtual Command Examples ===\n');

async function example1_BasicGitWorkflow() {
  console.log('Example 1: Basic Git Workflow with cd\n');
  
  const tempDir = mkdtempSync(join(tmpdir(), 'git-example-'));
  const originalCwd = process.cwd();
  
  try {
    // Navigate to temp directory and initialize git
    await $`cd ${tempDir}`;
    await $`git init`;
    await $`git config user.email "example@test.com"`;
    await $`git config user.name "Example User"`;
    
    // Create and commit a file
    await $`echo "# My Project" > README.md`;
    await $`git add README.md`;
    await $`git commit -m "Initial commit"`;
    
    // Show the log
    await $`git log --oneline`;
    
    // Return to original directory
    await $`cd ${originalCwd}`;
    
    console.log(`✓ Successfully created git repo in ${tempDir}\n`);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function example2_MultipleTempRepos() {
  console.log('Example 2: Working with Multiple Temp Repositories\n');
  
  const repo1 = mkdtempSync(join(tmpdir(), 'repo1-'));
  const repo2 = mkdtempSync(join(tmpdir(), 'repo2-'));
  const originalCwd = process.cwd();
  
  try {
    // Initialize first repository
    await $`cd ${repo1} && git init && git config user.email "repo1@test.com"`;
    await $`cd ${repo1} && echo "Repo 1 Content" > file.txt`;
    await $`cd ${repo1} && git add . && git commit -m "Repo 1 commit"`;
    
    // Initialize second repository
    await $`cd ${repo2} && git init && git config user.email "repo2@test.com"`;
    await $`cd ${repo2} && echo "Repo 2 Content" > file.txt`;
    await $`cd ${repo2} && git add . && git commit -m "Repo 2 commit"`;
    
    // Check both repositories
    console.log('Repo 1 log:');
    await $`cd ${repo1} && git log --oneline`;
    
    console.log('\nRepo 2 log:');
    await $`cd ${repo2} && git log --oneline`;
    
    await $`cd ${originalCwd}`;
    
    console.log('✓ Successfully managed multiple repositories\n');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(repo1, { recursive: true, force: true });
    rmSync(repo2, { recursive: true, force: true });
  }
}

async function example3_BranchingWorkflow() {
  console.log('Example 3: Git Branching Workflow\n');
  
  const tempDir = mkdtempSync(join(tmpdir(), 'branch-example-'));
  const originalCwd = process.cwd();
  
  try {
    // Setup repository
    await $`cd ${tempDir}`;
    await $`git init`;
    await $`git config user.email "branch@test.com"`;
    await $`git config user.name "Branch Example"`;
    
    // Create initial commit
    await $`echo "Initial content" > main.txt`;
    await $`git add .`;
    await $`git commit -m "Initial commit"`;
    
    // Create and switch to feature branch
    await $`git checkout -b feature-branch`;
    await $`echo "Feature content" > feature.txt`;
    await $`git add .`;
    await $`git commit -m "Add feature"`;
    
    // Show branch info
    const currentBranch = await $`git branch --show-current`;
    console.log(`Current branch: ${currentBranch.stdout.trim()}`);
    
    // List all branches
    await $`git branch -a`;
    
    // Switch back to main/master
    const mainBranch = await $`git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "master"`;
    await $`git checkout ${mainBranch.stdout.trim() || 'master'}`;
    
    await $`cd ${originalCwd}`;
    
    console.log('✓ Branching workflow completed\n');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function example4_GitDiffWorkflow() {
  console.log('Example 4: Git Diff and Status Workflow\n');
  
  const tempDir = mkdtempSync(join(tmpdir(), 'diff-example-'));
  const originalCwd = process.cwd();
  
  try {
    // Use cd chains for all operations
    await $`cd ${tempDir} && git init`;
    await $`cd ${tempDir} && git config user.email "diff@test.com"`;
    await $`cd ${tempDir} && git config user.name "Diff Example"`;
    
    // Create initial commit
    await $`cd ${tempDir} && echo "Line 1" > file.txt`;
    await $`cd ${tempDir} && git add . && git commit -m "Initial"`;
    
    // Make changes
    await $`cd ${tempDir} && echo "Line 2" >> file.txt`;
    
    // Show status
    console.log('Git status:');
    await $`cd ${tempDir} && git status --short`;
    
    // Show diff
    console.log('\nGit diff:');
    await $`cd ${tempDir} && git diff`;
    
    // Stage and commit changes
    await $`cd ${tempDir} && git add . && git commit -m "Add line 2"`;
    
    // Show final log
    await $`cd ${tempDir} && git log --oneline`;
    
    await $`cd ${originalCwd}`;
    
    console.log('✓ Diff workflow completed\n');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// Run all examples
async function runExamples() {
  try {
    await example1_BasicGitWorkflow();
    await example2_MultipleTempRepos();
    await example3_BranchingWorkflow();
    await example4_GitDiffWorkflow();
    
    console.log('=== All Git Examples Completed Successfully ===');
  } catch (error) {
    console.error('Failed to run examples:', error);
    process.exit(1);
  }
}

runExamples();