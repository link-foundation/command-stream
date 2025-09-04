#!/usr/bin/env node

/**
 * Claude Profiles - Manage Claude configuration profiles using GitHub Gists
 * 
 * This tool uses use-m for dynamic module loading, requiring no package.json dependencies.
 * It stores Claude configurations as base64-encoded zip files in GitHub Gists.
 * 
 * Features:
 * - Store/restore Claude configurations
 * - Multiple profile management
 * - Profile verification
 * - Watch mode with filesystem monitoring
 * - Verbose logging and file logging support
 */

import { $ } from './src/$.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createWriteStream } from 'fs';
import { promises as fsPromises } from 'fs';
import { createHash } from 'crypto';

// Dynamically load dependencies using use-m
const { use } = eval(
  await fetch('https://unpkg.com/use-m/use.js').then(r => r.text())
);

// Load required packages dynamically with specific versions
const [yargs, yargsHelpers, archiver] = await Promise.all([
  use('yargs@17.7.2'),
  use('yargs@17.7.2/helpers'),
  use('archiver@7.0.1')
]);

const { hideBin } = yargsHelpers;

const PROFILE_NAME_REGEX = /^[a-z0-9-]+$/;

// Global logging configuration
let logFile = null;
let isVerbose = false;

/**
 * Initialize logging based on options
 */
function initLogging(options) {
  isVerbose = options.verbose || false;
  
  if (options.log !== undefined) {
    // User specified log option
    if (typeof options.log === 'string' && options.log.length > 0) {
      // User provided specific log file path
      logFile = options.log;
    } else {
      // User enabled logging with default filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, -5);
      logFile = `claude-profiles-${timestamp}.txt.log`;
    }
    
    // Write initial log header
    const header = `Claude Profiles Log - Started at ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`;
    try {
      fs.writeFileSync(logFile, header);
      log('INFO', `Logging initialized to file: ${logFile}`);
    } catch (error) {
      console.error(`Warning: Could not create log file: ${error.message}`);
      logFile = null;
    }
  }
}

/**
 * Log a message to console and optionally to file
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}`;
  
  // Always log errors and warnings
  if (level === 'ERROR') {
    console.error(message);
  } else if (level === 'WARN') {
    console.warn(message);
  } else if (level === 'INFO') {
    console.log(message);
  } else if (level === 'DEBUG' && isVerbose) {
    console.log(`[DEBUG] ${message}`);
  } else if (level === 'TRACE' && isVerbose) {
    console.log(`[TRACE] ${message}`);
  }
  
  // Write to log file if enabled
  if (logFile) {
    try {
      let fileEntry = logEntry;
      if (data) {
        fileEntry += '\n' + JSON.stringify(data, null, 2);
      }
      fs.appendFileSync(logFile, fileEntry + '\n');
    } catch (error) {
      // Silently fail to avoid recursive logging issues
    }
  }
}

// Files and directories to backup/restore
const BACKUP_PATHS = [
  { source: '~/.claude', dest: '.claude' },
  { source: '~/.claude.json', dest: '.claude.json' },
  { source: '~/.claude.json.backup', dest: '.claude.json.backup' }
];

/**
 * Expand tilde (~) to home directory
 */
function expandHome(filepath) {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Validate profile name
 */
function validateProfileName(name) {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(`Invalid profile name: ${name}. Only lowercase letters, numbers, and hyphens are allowed.`);
  }
  return true;
}

/**
 * Find or create the gist for storing profiles
 */
async function findOrCreateGist() {
  // Use API to find gist by description
  try {
    const apiResult = await $`gh api /gists --jq '.[] | select(.description == "claude-profiles-backup") | .id' | head -1`.run({ capture: true, mirror: false });
    const gistId = apiResult.stdout.trim();
    if (gistId) {
      return gistId;
    }
  } catch (error) {
    // Check if it's a network/API error
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      // Gist not found, will create new one
    } else if (error.message?.includes('rate limit')) {
      console.error('⚠️  GitHub API rate limit exceeded');
      console.error('   Please wait a few minutes and try again');
      console.error('   Or authenticate with a different account');
      process.exit(1);
    } else if (error.message?.includes('network') || error.message?.includes('timeout')) {
      console.error('🌐 Network error while accessing GitHub');
      console.error('   Please check your internet connection and try again');
      process.exit(1);
    }
    // Otherwise, gist just doesn't exist yet
  }
  
  // Create new gist if not found
  console.log(`📝 Creating new secret gist for profile storage...`);
  const tempFile = path.join(os.tmpdir(), 'claude-profiles-readme.md');
  const readmeContent = `# Claude Profiles Backup

This gist stores Claude profile backups as zip files (base64 encoded).

Created by claude-profiles.mjs tool.
Do not edit this gist manually.

## Profiles

Each .zip.base64 file contains a backup of:
- ~/.claude/ directory
- ~/.claude.json
- ~/.claude.json.backup
`;
  
  await fsPromises.writeFile(tempFile, readmeContent);
  
  try {
    const createResult = await $`gh gist create ${tempFile} --desc "claude-profiles-backup" 2>&1`.run({ capture: true, mirror: false });
    await fsPromises.unlink(tempFile);
    
    if (createResult.code !== 0) {
      if (createResult.stdout.includes('gist.github.com')) {
        // Sometimes gh returns non-zero but still creates the gist
        const gistUrl = createResult.stdout.match(/https:\/\/gist\.github\.com\/\S+/)?.[0];
        if (gistUrl) {
          const gistId = gistUrl.split('/').pop();
          console.log(`✅ Gist created successfully`);
          return gistId;
        }
      }
      
      // Parse error message for common issues
      if (createResult.stdout.includes('permission') || createResult.stdout.includes('scope')) {
        console.error('❌ Permission error creating gist');
        console.error('   Your GitHub token may not have "gist" scope');
        console.error('   Please run: gh auth refresh -s gist');
        process.exit(1);
      }
      
      throw new Error(createResult.stdout || 'Unknown error creating gist');
    }
    
    // Extract gist ID from the URL
    const gistUrl = createResult.stdout.trim();
    const gistId = gistUrl.split('/').pop();
    console.log(`✅ Gist created successfully`);
    return gistId;
  } catch (error) {
    await fsPromises.unlink(tempFile).catch(() => {});
    
    console.error('❌ Failed to create gist');
    console.error(`   Error: ${error.message}`);
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error('   1. Check your internet connection');
    console.error('   2. Verify GitHub authentication: gh auth status');
    console.error('   3. Ensure you have gist permissions: gh auth refresh -s gist');
    console.error('   4. Try creating a test gist manually: echo "test" | gh gist create -');
    process.exit(1);
  }
}

/**
 * List all profiles in the gist
 */
async function listProfiles() {
  try {
    const gistId = await findOrCreateGist();
    
    // Get gist files
    const result = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
    const allFiles = result.stdout.trim().split('\n');
    const files = allFiles.filter(f => f.endsWith('.zip.base64'));
    
    if (files.length === 0) {
      console.log('📋 No saved profiles found');
      console.log('');
      console.log('💡 To store your first profile, run:');
      console.log('   ./claude-profiles.mjs --store <profile_name>');
      return;
    }
    
    console.log('📋 Saved Claude Profiles:');
    console.log('');
    
    for (const file of files) {
      const profileName = file.replace('.zip.base64', '');
      console.log(`  📁 ${profileName}`);
    }
    
    console.log('');
    console.log('💡 Usage:');
    console.log('   ./claude-profiles.mjs --restore <profile_name>  # Restore a profile');
    console.log('   ./claude-profiles.mjs --store <profile_name>     # Store current state');
    console.log('   ./claude-profiles.mjs --delete <profile_name>   # Delete a profile');
  } catch (error) {
    console.error('❌ Error listing profiles:', error.message);
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error('   • Check your internet connection');
    console.error('   • Verify GitHub authentication: gh auth status');
    console.error('   • Try: gh gist list --limit 1');
    process.exit(1);
  }
}

/**
 * Verify local files before creating a profile
 */
function verifyLocalFiles() {
  const checks = [
    {
      path: expandHome('~/.claude/.credentials.json'),
      essential: true,
      description: 'Claude credentials',
      icon: '🔑'
    },
    {
      path: expandHome('~/.claude.json'),
      essential: true,
      description: 'Claude configuration',
      icon: '⚙️'
    },
    {
      path: expandHome('~/.claude.json.backup'),
      essential: false,
      description: 'Configuration backup',
      icon: '💾'
    }
  ];
  
  console.log('🔍 Verifying local Claude configuration...');
  console.log('');
  
  let hasAllEssential = true;
  const issues = [];
  
  for (const check of checks) {
    try {
      const stats = fs.statSync(check.path);
      if (stats.isFile()) {
        console.log(`   ${check.icon} ${check.description}: ✅`);
        
        // For credentials, do a basic validation
        if (check.path.includes('.credentials.json')) {
          try {
            const content = fs.readFileSync(check.path, 'utf8');
            const creds = JSON.parse(content);
            if (!creds.sessionKey && !creds.token) {
              console.log(`      └─ ⚠️  Credentials may be incomplete`);
              issues.push('Credentials file exists but may be incomplete');
            }
          } catch {
            console.log(`      └─ ⚠️  Could not parse credentials file`);
            issues.push('Credentials file could not be parsed');
          }
        }
      }
    } catch (error) {
      if (check.essential) {
        console.log(`   ${check.icon} ${check.description}: ❌ Missing (REQUIRED)`);
        hasAllEssential = false;
        issues.push(`Missing required file: ${check.description}`);
      } else {
        console.log(`   ${check.icon} ${check.description}: ⚠️  Missing (optional)`);
      }
    }
  }
  
  console.log('');
  
  return { valid: hasAllEssential, issues };
}

/**
 * Verify a profile contains essential files
 */
async function verifyProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    console.log(`🔍 Verifying Claude profile: ${profileName}`);
    
    // Get gist ID
    const gistId = await findOrCreateGist();
    
    // Create temporary directory
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-verify-'));
    const zipPath = path.join(tempDir, `${profileName}.zip`);
    
    try {
      // Download the profile using API (more reliable for large files)
      console.log(`📥 Downloading profile for verification...`);
      
      // First check if file exists
      const filesResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
      if (!filesResult.stdout.includes(`${profileName}.zip.base64`)) {
        throw new Error(`Profile '${profileName}' not found`);
      }
      
      // Use API to get the raw URL
      const apiResult = await $`gh api /gists/${gistId}`.run({ capture: true, mirror: false });
      const gistData = JSON.parse(apiResult.stdout);
      const fileData = gistData.files[`${profileName}.zip.base64`];
      
      if (!fileData) {
        throw new Error(`Profile '${profileName}' not found in gist`);
      }
      
      let base64Data;
      
      if (fileData.truncated) {
        // File is truncated, need to fetch from raw_url
        console.log(`   Profile is large (${Math.round(fileData.size / 1024)} KB), downloading from raw URL...`);
        const rawResult = await $`curl -s "${fileData.raw_url}"`.run({ capture: true, mirror: false });
        base64Data = rawResult.stdout.trim();
      } else {
        // Small file, content is in the API response
        base64Data = fileData.content.trim();
      }
      
      // Validate it's base64
      if (!base64Data || base64Data.length === 0) {
        throw new Error('Downloaded profile data is empty');
      }
      
      try {
        const zipBuffer = Buffer.from(base64Data, 'base64');
        await fsPromises.writeFile(zipPath, zipBuffer);
      } catch (err) {
        throw new Error(`Failed to decode profile data: ${err.message}`);
      }
      
      // Extract to verify contents
      console.log(`📂 Extracting profile...`);
      const extractDir = path.join(tempDir, 'extract');
      await fsPromises.mkdir(extractDir);
      
      const extractResult = await $`unzip -q -o ${zipPath} -d ${extractDir} 2>&1`.run({ 
        capture: true, 
        mirror: false 
      });
      
      if (extractResult.code !== 0) {
        throw new Error(`Failed to extract profile archive: ${extractResult.stdout || 'Unknown error'}`);
      }
      
      // Check for essential files
      console.log(`\n📋 Checking profile contents:`);
      console.log('');
      
      const checks = [
        {
          path: '.claude/.credentials.json',
          essential: true,
          description: 'Claude credentials',
          icon: '🔑'
        },
        {
          path: '.claude.json',
          essential: true,
          description: 'Claude configuration',
          icon: '⚙️'
        },
        {
          path: '.claude.json.backup',
          essential: false,
          description: 'Configuration backup',
          icon: '💾'
        },
        {
          path: '.claude',
          essential: false,
          description: 'Claude directory',
          icon: '📁',
          isDirectory: true
        }
      ];
      
      let hasEssentialFiles = true;
      let totalSize = 0;
      const foundFiles = [];
      
      for (const check of checks) {
        const fullPath = path.join(extractDir, check.path);
        try {
          const stats = await fsPromises.stat(fullPath);
          
          if (check.isDirectory) {
            if (stats.isDirectory()) {
              // Count files in directory
              const files = await fsPromises.readdir(fullPath);
              console.log(`   ${check.icon} ${check.description}: ✅ (${files.length} files)`);
              foundFiles.push(check.path);
            } else {
              console.log(`   ${check.icon} ${check.description}: ❌ Not a directory`);
            }
          } else {
            if (stats.isFile()) {
              const sizeKB = Math.round(stats.size / 1024);
              totalSize += stats.size;
              console.log(`   ${check.icon} ${check.description}: ✅ (${sizeKB} KB)`);
              foundFiles.push(check.path);
              
              // For credentials, do a basic validation
              if (check.path === '.claude/.credentials.json') {
                try {
                  const content = await fsPromises.readFile(fullPath, 'utf8');
                  const creds = JSON.parse(content);
                  if (creds.sessionKey || creds.token) {
                    console.log(`      └─ Valid credentials structure detected`);
                  } else {
                    console.log(`      └─ ⚠️  Credentials file exists but may be incomplete`);
                  }
                } catch {
                  console.log(`      └─ ⚠️  Could not parse credentials file`);
                }
              }
            } else {
              console.log(`   ${check.icon} ${check.description}: ❌ Not a file`);
              if (check.essential) {
                hasEssentialFiles = false;
              }
            }
          }
        } catch (error) {
          if (check.essential) {
            console.log(`   ${check.icon} ${check.description}: ❌ Missing (REQUIRED)`);
            hasEssentialFiles = false;
          } else {
            console.log(`   ${check.icon} ${check.description}: ⚠️  Missing (optional)`);
          }
        }
      }
      
      // Show summary
      console.log('');
      console.log(`📊 Summary:`);
      console.log(`   • Profile size: ${Math.round(totalSize / 1024)} KB compressed`);
      console.log(`   • Files found: ${foundFiles.length}`);
      console.log(`   • Created: Check gist history`);
      
      console.log('');
      if (hasEssentialFiles) {
        console.log(`✅ Profile '${profileName}' is valid and ready to restore`);
      } else {
        console.log(`❌ Profile '${profileName}' is missing essential files`);
        console.log('   This profile may not restore correctly');
        console.log('   Consider creating a new backup with --store');
      }
      
    } finally {
      // Clean up temp directory
      await fsPromises.rm(tempDir, { recursive: true }).catch(() => {});
    }
    
  } catch (error) {
    console.error('❌ Error verifying profile:', error.message);
    
    if (error.message.includes('not found')) {
      console.error('');
      console.error('📝 Available profiles:');
      try {
        const listResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
        const files = listResult.stdout.trim().split('\n').filter(f => f.endsWith('.zip.base64'));
        if (files.length > 0) {
          files.forEach(f => console.error(`   • ${f.replace('.zip.base64', '')}`));
        } else {
          console.error('   (no profiles found)');
        }
      } catch {}
    } else if (error.message.includes('unzip')) {
      console.error('');
      console.error('📦 The unzip command is required for verification');
      console.error('   • macOS: Should be pre-installed');
      console.error('   • Ubuntu/Debian: sudo apt-get install unzip');
      console.error('   • Alpine: apk add unzip');
    }
    
    process.exit(1);
  }
}

/**
 * Calculate hash of files to detect changes
 */
async function calculateFilesHash() {
  const hash = createHash('sha256');
  
  for (const item of BACKUP_PATHS) {
    const sourcePath = expandHome(item.source);
    
    try {
      const stats = await fsPromises.stat(sourcePath);
      
      if (stats.isDirectory()) {
        // Hash directory structure and file names
        const files = await fsPromises.readdir(sourcePath, { recursive: true });
        hash.update(files.sort().join('|'));
        
        // Hash each file's content
        for (const file of files) {
          const filePath = path.join(sourcePath, file);
          try {
            const fileStats = await fsPromises.stat(filePath);
            if (fileStats.isFile()) {
              const content = await fsPromises.readFile(filePath);
              hash.update(content);
            }
          } catch {
            // Skip files we can't read
          }
        }
      } else if (stats.isFile()) {
        const content = await fsPromises.readFile(sourcePath);
        hash.update(content);
      }
    } catch {
      // File doesn't exist, that's ok
    }
  }
  
  return hash.digest('hex');
}

/**
 * Watch for changes and auto-save profile
 */
async function watchProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    log('INFO', `🔄 Starting watch mode for profile: ${profileName}`);
    log('INFO', '   Monitoring Claude configuration files for changes...');
    log('INFO', '   Press Ctrl+C to stop watching');
    
    // Verify initial state
    const verification = verifyLocalFiles();
    if (!verification.valid) {
      log('ERROR', '❌ Cannot start watch mode - essential files are missing');
      if (verification.issues.length > 0) {
        verification.issues.forEach(issue => log('ERROR', `   • ${issue}`));
      }
      process.exit(1);
    }
    
    let lastSaveTime = 0;
    let pendingSave = false;
    let lastHash = await calculateFilesHash();
    let saveCount = 0;
    
    log('DEBUG', `Initial files hash: ${lastHash}`);
    
    // Watch configuration
    const minSaveInterval = 30000; // Minimum 30 seconds between saves
    const debounceDelay = 2000; // Wait 2 seconds after last change
    
    let pendingSaveTimeout = null;
    let changeDetected = false;
    const watchers = [];
    
    // Function to handle file changes
    const handleFileChange = (eventType, filename) => {
      log('DEBUG', `File change detected: ${eventType} on ${filename || 'unknown'}`);
      changeDetected = true;
      
      // Clear any pending save timeout
      if (pendingSaveTimeout) {
        clearTimeout(pendingSaveTimeout);
        log('TRACE', 'Cleared pending save timeout due to new change');
      }
      
      // Debounce: wait for changes to settle
      log('TRACE', `Setting debounce timer for ${debounceDelay}ms`);
      pendingSaveTimeout = setTimeout(async () => {
        if (!changeDetected) {
          log('TRACE', 'No changes detected during debounce period');
          return;
        }
        changeDetected = false;
        
        const now = Date.now();
        const timeSinceLastSave = now - lastSaveTime;
        
        if (timeSinceLastSave >= minSaveInterval) {
          // Enough time has passed, save immediately
          log('INFO', '📝 Changes detected, saving profile...');
          
          try {
            // Don't show all the normal save output in watch mode
            const originalLog = console.log;
            const originalError = console.error;
            
            if (!isVerbose) {
              console.log = () => {};
              console.error = () => {};
            }
            
            await saveProfileSilent(profileName);
            
            if (!isVerbose) {
              console.log = originalLog;
              console.error = originalError;
            }
            
            lastSaveTime = now;
            lastHash = await calculateFilesHash();
            saveCount++;
            pendingSave = false;
            
            log('INFO', `✅ Profile auto-saved (save #${saveCount})`);
            log('DEBUG', `Save completed at ${new Date(now).toISOString()}`);
            log('TRACE', `Next save allowed after: ${new Date(now + minSaveInterval).toISOString()}`);
            
          } catch (error) {
            log('ERROR', `❌ Failed to auto-save: ${error.message}`);
          }
        } else if (!pendingSave) {
          // Schedule a save for when enough time has passed
          pendingSave = true;
          const timeToWait = minSaveInterval - timeSinceLastSave;
          log('INFO', `⏳ Changes detected, will save in ${Math.round(timeToWait / 1000)} seconds...`);
          
          pendingSaveTimeout = setTimeout(async () => {
            if (pendingSave) {
              log('INFO', '📝 Saving pending changes...');
              
              try {
                const originalLog = console.log;
                const originalError = console.error;
                
                if (!isVerbose) {
                  console.log = () => {};
                  console.error = () => {};
                }
                
                await saveProfileSilent(profileName);
                
                if (!isVerbose) {
                  console.log = originalLog;
                  console.error = originalError;
                }
                
                lastSaveTime = Date.now();
                lastHash = await calculateFilesHash();
                saveCount++;
                pendingSave = false;
                
                log('INFO', `✅ Profile auto-saved (save #${saveCount})`);
                
              } catch (error) {
                log('ERROR', `❌ Failed to auto-save: ${error.message}`);
                pendingSave = false;
              }
            }
          }, timeToWait);
        }
      }, debounceDelay);
    };
    
    // Set up file watchers for each backup path
    for (const item of BACKUP_PATHS) {
      const watchPath = expandHome(item.source);
      
      try {
        const stats = await fsPromises.stat(watchPath);
        
        // Create watcher with options
        const watcher = fs.watch(watchPath, { 
          recursive: stats.isDirectory(),
          persistent: true
        }, (eventType, filename) => {
          handleFileChange(eventType, `${item.source}/${filename || ''}`);
        });
        
        // Add error handler for watcher
        watcher.on('error', (error) => {
          log('ERROR', `Watcher error for ${item.source}: ${error.message}`);
        });
        
        watchers.push(watcher);
        log('DEBUG', `Watching: ${item.source} (${stats.isDirectory() ? 'directory' : 'file'})`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log('WARN', `Could not watch ${item.source}: ${error.message}`);
        }
      }
    }
    
    if (watchers.length === 0) {
      log('ERROR', 'No files to watch!');
      process.exit(1);
    }
    
    log('INFO', `📊 Watching ${watchers.length} paths for changes`);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      log('INFO', '\n👋 Stopping watch mode...');
      
      // Close all watchers
      watchers.forEach(watcher => watcher.close());
      
      // Clear any pending timeouts
      if (pendingSaveTimeout) {
        clearTimeout(pendingSaveTimeout);
        log('INFO', 'Cancelled pending save');
      }
      
      log('INFO', `Watch mode ended - Total saves: ${saveCount}`);
      
      if (logFile) {
        console.log(`\n📄 Log saved to: ${logFile}`);
      }
      
      process.exit(0);
    });
    
    // Keep process running
    process.stdin.resume();
    
  } catch (error) {
    log('ERROR', `❌ Error in watch mode: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Save profile without console output (for watch mode)
 */
async function saveProfileSilent(profileName) {
  // This is a simplified version of saveProfile that doesn't output to console
  // It reuses the same logic but skips console.log calls
  
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-profile-'));
  const zipPath = path.join(tempDir, `${profileName}.zip`);
  
  try {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    const archivePromise = new Promise((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
    });
    
    archive.pipe(output);
    
    // Add files to archive
    for (const item of BACKUP_PATHS) {
      const sourcePath = expandHome(item.source);
      try {
        const stats = await fsPromises.stat(sourcePath);
        if (stats.isDirectory()) {
          archive.directory(sourcePath, item.dest);
        } else if (stats.isFile()) {
          archive.file(sourcePath, { name: item.dest });
        }
      } catch {
        // Skip missing files
      }
    }
    
    await archive.finalize();
    await archivePromise;
    
    // Get or create gist
    const gistId = await findOrCreateGist();
    
    // Convert to base64
    const zipBuffer = await fsPromises.readFile(zipPath);
    const base64Content = zipBuffer.toString('base64');
    const base64Path = path.join(tempDir, `${profileName}.zip.base64`);
    await fsPromises.writeFile(base64Path, base64Content);
    
    // Upload to gist
    const uploadResult = await $`gh gist edit ${gistId} --add ${base64Path} --filename "${profileName}.zip.base64" 2>&1`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (uploadResult.code !== 0 && !uploadResult.stdout.includes('Added')) {
      throw new Error(`Failed to upload: ${uploadResult.stdout}`);
    }
    
    log('DEBUG', `Profile uploaded successfully - Size: ${Math.round(zipBuffer.length / 1024)} KB`);
    
  } finally {
    await fsPromises.rm(tempDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Delete a profile from the gist
 */
async function deleteProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    console.log(`🗑️  Deleting Claude profile: ${profileName}`);
    
    // Get gist ID
    const gistId = await findOrCreateGist();
    
    // Check if profile exists
    const listResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
    const files = listResult.stdout.trim().split('\n').filter(f => f);
    const profileFile = `${profileName}.zip.base64`;
    
    if (!files.includes(profileFile)) {
      throw new Error(`Profile '${profileName}' not found`);
    }
    
    // We need to use a different approach - gh api to update gist
    
    // Create update payload - set the file to delete as null
    const updatePayload = {
      files: {
        [profileFile]: null  // Setting to null deletes the file
      }
    };
    
    // Update the gist using gh api
    const updateResult = await $`gh api /gists/${gistId} --method PATCH --input -`.run({
      capture: true,
      mirror: false,
      stdin: JSON.stringify(updatePayload)
    });
    
    if (updateResult.code === 0) {
      console.log(`✅ Profile '${profileName}' deleted successfully`);
    } else {
      throw new Error('Failed to delete profile from gist');
    }
    
  } catch (error) {
    console.error('❌ Error deleting profile:', error.message);
    
    if (error.message.includes('not found')) {
      console.error('');
      console.error('📝 Profile does not exist. Available profiles:');
      try {
        await listProfiles();
      } catch {}
    } else {
      console.error('');
      console.error('🔧 Troubleshooting:');
      console.error('   • Check your internet connection');
      console.error('   • Verify the profile exists: ./claude-profiles.mjs --list');
      console.error('   • Ensure you have write permissions to the gist');
    }
    process.exit(1);
  }
}

/**
 * Save current Claude configuration to a profile
 */
async function saveProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    console.log(`💾 Preparing to save Claude profile: ${profileName}`);
    console.log('');
    
    // Verify local files before creating backup
    const verification = verifyLocalFiles();
    
    if (!verification.valid) {
      console.error('❌ Cannot create profile - essential files are missing');
      console.error('');
      if (verification.issues.length > 0) {
        console.error('Issues found:');
        verification.issues.forEach(issue => console.error(`   • ${issue}`));
        console.error('');
      }
      console.error('💡 Tips:');
      console.error('   • Ensure Claude is properly configured');
      console.error('   • Try using Claude at least once to generate config files');
      console.error('   • Check that ~/.claude/ directory exists');
      process.exit(1);
    }
    
    console.log('✅ Local configuration verified');
    console.log('');
    
    // Create temporary directory for staging
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-profile-'));
    const zipPath = path.join(tempDir, `${profileName}.zip`);
    
    // Create zip archive
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Create a promise to track when archiving is complete
    const archivePromise = new Promise((resolve, reject) => {
      output.on('close', () => {
        resolve();
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
    });
    
    archive.pipe(output);
    
    // Add files to archive
    let hasFiles = false;
    for (const item of BACKUP_PATHS) {
      const sourcePath = expandHome(item.source);
      
      try {
        const stats = await fsPromises.stat(sourcePath);
        
        if (stats.isDirectory()) {
          archive.directory(sourcePath, item.dest);
          console.log(`📂 Added directory: ${item.source}`);
          hasFiles = true;
        } else if (stats.isFile()) {
          archive.file(sourcePath, { name: item.dest });
          console.log(`📄 Added file: ${item.source}`);
          hasFiles = true;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn(`⚠️  Could not add ${item.source}: ${error.message}`);
        }
      }
    }
    
    if (!hasFiles) {
      console.error('❌ No Claude configuration files found to backup');
      console.error('');
      console.error('📝 Expected files:');
      console.error('   • ~/.claude/ directory');
      console.error('   • ~/.claude.json file');
      console.error('   • ~/.claude.json.backup file');
      console.error('');
      console.error('🔧 This usually means Claude is not configured yet');
      console.error('   Please use Claude at least once to generate config files');
      await fsPromises.rm(tempDir, { recursive: true });
      process.exit(1);
    }
    
    await archive.finalize();
    
    // Wait for the archive to be written to disk
    await archivePromise;
    
    const archiveStats = await fsPromises.stat(zipPath);
    console.log(`📦 Archive created: ${Math.round(archiveStats.size / 1024)} KB`);
    
    // Get or create gist
    const gistId = await findOrCreateGist();
    
    // Convert zip to base64 for gist storage
    const zipBuffer = await fsPromises.readFile(zipPath);
    const base64Content = zipBuffer.toString('base64');
    
    // Save base64 as text file
    const base64Path = path.join(tempDir, `${profileName}.zip.base64`);
    await fsPromises.writeFile(base64Path, base64Content);
    
    // Upload base64 file to gist
    console.log(`📤 Uploading profile to gist...`);
    const uploadResult = await $`gh gist edit ${gistId} --add ${base64Path} --filename "${profileName}.zip.base64" 2>&1`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (uploadResult.code !== 0 && !uploadResult.stdout.includes('Added')) {
      // Check for common issues
      if (uploadResult.stdout.includes('too large')) {
        console.error('❌ Profile is too large for GitHub Gist (>10MB)');
        console.error('   Consider cleaning up ~/.claude/ directory');
        throw new Error('Profile too large');
      } else if (uploadResult.stdout.includes('rate limit')) {
        console.error('⚠️  GitHub API rate limit exceeded');
        console.error('   Please wait a few minutes and try again');
        throw new Error('Rate limit exceeded');
      }
      throw new Error(`Failed to upload profile to gist: ${uploadResult.stdout}`);
    }
    
    // Clean up temp directory
    await fsPromises.rm(tempDir, { recursive: true });
    
    console.log(`✅ Profile '${profileName}' saved successfully`);
    console.log('');
    console.log('💡 To restore this profile later, run:');
    console.log(`   ./claude-profiles.mjs --restore ${profileName}`);
  } catch (error) {
    console.error('❌ Error saving profile:', error.message);
    console.error('');
    
    if (error.message.includes('Profile too large') || error.message.includes('Rate limit')) {
      // Specific error messages already shown
    } else {
      console.error('🔧 Troubleshooting:');
      console.error('   • Check your internet connection');
      console.error('   • Verify write permissions: gh auth status');
      console.error('   • Try creating a test gist: echo "test" | gh gist create -');
      console.error('   • Check available profiles: ./claude-profiles.mjs --list');
    }
    process.exit(1);
  }
}

/**
 * Verify a downloaded profile before restoring
 */
async function verifyDownloadedProfile(profileName, tempDir) {
  const extractDir = path.join(tempDir, 'verify');
  const zipPath = path.join(tempDir, `${profileName}.zip`);
  
  try {
    await fsPromises.mkdir(extractDir);
    
    // Extract for verification
    const extractResult = await $`unzip -q -o ${zipPath} -d ${extractDir} 2>&1`.run({ 
      capture: true, 
      mirror: false 
    });
    
    if (extractResult.code !== 0) {
      return { valid: false, issues: ['Failed to extract profile archive'] };
    }
    
    // Check essential files
    const checks = [
      {
        path: path.join(extractDir, '.claude/.credentials.json'),
        essential: true,
        description: 'Claude credentials'
      },
      {
        path: path.join(extractDir, '.claude.json'),
        essential: true,
        description: 'Claude configuration'
      }
    ];
    
    let valid = true;
    const issues = [];
    
    for (const check of checks) {
      try {
        const stats = await fsPromises.stat(check.path);
        if (!stats.isFile() && check.essential) {
          valid = false;
          issues.push(`Missing: ${check.description}`);
        }
      } catch {
        if (check.essential) {
          valid = false;
          issues.push(`Missing: ${check.description}`);
        }
      }
    }
    
    // Clean up verification directory
    await fsPromises.rm(extractDir, { recursive: true }).catch(() => {});
    
    return { valid, issues };
  } catch (error) {
    return { valid: false, issues: [error.message] };
  }
}

/**
 * Restore a profile from the gist
 */
async function restoreProfile(profileName) {
  try {
    validateProfileName(profileName);
    
    console.log(`📦 Preparing to restore Claude profile: ${profileName}`);
    console.log('');
    
    // Get gist ID
    const gistId = await findOrCreateGist();
    
    // Create temporary directory
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'claude-restore-'));
    const zipPath = path.join(tempDir, `${profileName}.zip`);
    
    // Download the profile using API (same as verify function)
    console.log(`📥 Downloading profile from gist...`);
    
    // First check if file exists
    const filesResult = await $`gh gist view ${gistId} --files`.run({ capture: true, mirror: false });
    if (!filesResult.stdout.includes(`${profileName}.zip.base64`)) {
      console.error(`❌ Profile '${profileName}' not found`);
      console.error('');
      console.error('📝 Available profiles:');
      const files = filesResult.stdout.trim().split('\n').filter(f => f.endsWith('.zip.base64'));
      if (files.length > 0) {
        files.forEach(f => console.error(`   • ${f.replace('.zip.base64', '')}`));
      } else {
        console.error('   (no profiles found)');
      }
      throw new Error('Profile not found');
    }
    
    // Use API to get the file content or raw URL
    const apiResult = await $`gh api /gists/${gistId}`.run({ capture: true, mirror: false });
    const gistData = JSON.parse(apiResult.stdout);
    const fileData = gistData.files[`${profileName}.zip.base64`];
    
    if (!fileData) {
      throw new Error(`Profile '${profileName}' not found in gist`);
    }
    
    let base64Data;
    
    if (fileData.truncated) {
      // File is truncated, need to fetch from raw_url
      console.log(`   Profile is large (${Math.round(fileData.size / 1024)} KB), downloading from raw URL...`);
      const rawResult = await $`curl -s "${fileData.raw_url}"`.run({ capture: true, mirror: false });
      base64Data = rawResult.stdout.trim();
    } else {
      // Small file, content is in the API response
      base64Data = fileData.content.trim();
    }
    
    if (!base64Data || base64Data.length === 0) {
      throw new Error('Downloaded profile data is empty');
    }
    
    // Decode base64 and write to zip file
    const zipBuffer = Buffer.from(base64Data, 'base64');
    await fsPromises.writeFile(zipPath, zipBuffer);
    
    // Verify the profile before restoring
    console.log(`🔍 Verifying profile integrity...`);
    const verification = await verifyDownloadedProfile(profileName, tempDir);
    
    if (!verification.valid) {
      console.error('');
      console.error('❌ Cannot restore profile - verification failed');
      if (verification.issues.length > 0) {
        console.error('');
        console.error('Issues found:');
        verification.issues.forEach(issue => console.error(`   • ${issue}`));
      }
      console.error('');
      console.error('💡 This profile appears to be corrupted or incomplete');
      console.error('   Consider creating a new backup with --store');
      throw new Error('Profile verification failed');
    }
    
    console.log('✅ Profile verified successfully');
    console.log('');
    
    // Extract zip archive for restoration
    console.log(`📂 Extracting profile...`);
    const extractDir = path.join(tempDir, 'extract');
    await fsPromises.mkdir(extractDir);
    
    // Use unzip command to extract
    await $`unzip -q -o ${zipPath} -d ${extractDir}`.run({ mirror: false });
    
    // Restore files from extracted directory
    for (const item of BACKUP_PATHS) {
      const sourcePath = path.join(extractDir, item.dest);
      const destPath = expandHome(item.source);
      
      try {
        const stats = await fsPromises.stat(sourcePath);
        
        if (stats.isDirectory()) {
          // Ensure parent directory exists
          await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
          // Copy directory recursively
          await $`cp -r ${sourcePath} ${destPath}`.run({ mirror: false });
          console.log(`📂 Restored directory: ${item.source}`);
        } else if (stats.isFile()) {
          // Ensure parent directory exists
          await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
          // Copy file
          await fsPromises.copyFile(sourcePath, destPath);
          console.log(`📄 Restored file: ${item.source}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn(`⚠️  Could not restore ${item.source}: ${error.message}`);
        }
      }
    }
    
    // Verify credentials were restored
    const credFile = expandHome('~/.claude/.credentials.json');
    try {
      await fsPromises.stat(credFile);
      console.log('🔑 Credentials file restored');
    } catch {
      console.warn('⚠️  No credentials file found in profile');
    }
    
    // Clean up temp directory
    await fsPromises.rm(tempDir, { recursive: true });
    
    console.log(`✅ Profile '${profileName}' restored successfully`);
    console.log('');
    console.log('💡 To save current state as a profile, run:');
    console.log('   ./claude-profiles.mjs --save <profile_name>');
  } catch (error) {
    if (!error.message.includes('Profile not found')) {
      console.error('❌ Error restoring profile:', error.message);
    }
    
    if (error.message.includes('unzip')) {
      console.error('');
      console.error('📦 The unzip command is required but not installed');
      console.error('   • macOS: Should be pre-installed');
      console.error('   • Ubuntu/Debian: sudo apt-get install unzip');
      console.error('   • Alpine: apk add unzip');
    } else if (!error.message.includes('Profile not found')) {
      console.error('');
      console.error('🔧 Troubleshooting:');
      console.error('   • Check your internet connection');
      console.error('   • Verify the profile exists: ./claude-profiles.mjs --list');
      console.error('   • Ensure you have read permissions for the gist');
      console.error('   • Check disk space for extracting the profile');
    }
    process.exit(1);
  }
}

// Main CLI setup
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .option('list', {
    alias: 'l',
    type: 'boolean',
    description: 'List all saved profiles'
  })
  .option('store', {
    alias: ['s', 'save'],
    type: 'string',
    description: 'Store current Claude configuration to a profile'
  })
  .option('restore', {
    alias: 'r',
    type: 'string',
    description: 'Restore a saved profile'
  })
  .option('delete', {
    alias: 'd',
    type: 'string',
    description: 'Delete a saved profile'
  })
  .option('verify', {
    alias: 'v',
    type: 'string',
    description: 'Verify a profile contains essential files'
  })
  .option('watch', {
    alias: 'w',
    type: 'string',
    description: 'Watch for changes and auto-save to profile (30s throttle)'
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging for debugging',
    default: false
  })
  .option('log', {
    type: 'string',
    description: 'Log output to file (provide path or use default)',
    coerce: (arg) => {
      // If --log is provided without value, return empty string to trigger default
      return arg === true ? '' : arg;
    }
  })
  .help('help')
  .alias('help', 'h')
  .example('$0 --list', 'List all saved profiles')
  .example('$0 --store work', 'Store current config as "work" profile')
  .example('$0 --save work', 'Same as --store (alias)')
  .example('$0 --restore personal', 'Restore "personal" profile')
  .example('$0 --delete old-profile', 'Delete "old-profile"')
  .example('$0 --verify work', 'Verify "work" profile integrity')
  .example('$0 --watch work', 'Watch for changes and auto-save')
  .example('$0 --watch work --verbose --log', 'Watch with debugging and logging')
  .epilogue('Profile names must contain only lowercase letters, numbers, and hyphens')
  .check((argv) => {
    const mainOptions = [argv.list, argv.store, argv.restore, argv.delete, argv.verify, argv.watch].filter(Boolean);
    if (mainOptions.length === 0) {
      throw new Error('Please specify one of: --list, --store, --restore, --delete, --verify, or --watch');
    }
    if (mainOptions.length > 1) {
      throw new Error('Please specify only one main option at a time');
    }
    return true;
  })
  .argv;

/**
 * Check GitHub authentication status with friendly messaging
 */
async function checkGitHubAuth() {
  try {
    const authResult = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    
    if (authResult.code === 0) {
      // Parse the output to check for gist scope
      const output = authResult.stdout;
      const scopesMatch = output.match(/Token scopes:\s*'([^']+)'/);
      
      // Check if gist scope is present
      if (scopesMatch && !scopesMatch[1].includes('gist')) {
        console.log('⚠️  Warning: Your GitHub token does not have "gist" scope');
        console.log('   You may need to re-authenticate with: gh auth login -s gist');
        console.log('');
      }
      
      return true;
    } else {
      return false;
    }
  } catch (error) {
    // gh command might not be installed
    if (error.message?.includes('not found') || error.message?.includes('command not found')) {
      console.error('❌ GitHub CLI (gh) is not installed');
      console.error('');
      console.error('📦 To install GitHub CLI:');
      console.error('   • macOS: brew install gh');
      console.error('   • Linux: See https://github.com/cli/cli#installation');
      console.error('   • Windows: winget install --id GitHub.cli');
      process.exit(1);
    }
    return false;
  }
}

// Execute the requested action
(async () => {
  try {
    // Initialize logging if needed
    initLogging({
      verbose: argv.verbose,
      log: argv.log
    });
    
    // Check if gh is authenticated
    const isAuthenticated = await checkGitHubAuth();
    
    if (!isAuthenticated) {
      console.error('🔐 GitHub CLI is not authenticated');
      console.error('');
      console.error('📝 To authenticate with GitHub:');
      console.error('   1. Run: gh auth login');
      console.error('   2. Follow the prompts to authenticate');
      console.error('   3. Make sure to grant "gist" scope when asked');
      console.error('');
      console.error('💡 Tips:');
      console.error('   • Use SSH if you have SSH keys set up');
      console.error('   • Use HTTPS with a token for simpler setup');
      console.error('   • You can also use: gh auth login -s gist');
      process.exit(1);
    }
    
    if (argv.list) {
      await listProfiles();
    } else if (argv.store) {
      await saveProfile(argv.store);
    } else if (argv.restore) {
      await restoreProfile(argv.restore);
    } else if (argv.delete) {
      await deleteProfile(argv.delete);
    } else if (argv.verify) {
      await verifyProfile(argv.verify);
    } else if (argv.watch) {
      await watchProfile(argv.watch);
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    
    // Provide helpful context for common errors
    if (error.code === 'EACCES') {
      console.error('');
      console.error('📝 Permission denied. This could mean:');
      console.error('   • You need sudo access (not recommended)');
      console.error('   • File permissions are incorrect');
      console.error('   • Try: ls -la ~/.claude/');
    } else if (error.code === 'ENOENT') {
      console.error('');
      console.error('📝 File or directory not found');
      console.error('   This usually means Claude configuration doesn\'t exist yet');
    } else if (error.code === 'ENOSPC') {
      console.error('');
      console.error('💾 No space left on device');
      console.error('   Please free up some disk space and try again');
    } else if (error.message?.includes('network')) {
      console.error('');
      console.error('🌐 Network issue detected');
      console.error('   • Check your internet connection');
      console.error('   • Check if GitHub is accessible');
      console.error('   • Try: ping github.com');
    }
    
    console.error('');
    console.error('For more help, check the tool documentation or report an issue');
    process.exit(1);
  }
})();