import fs from 'fs';
import path from 'path';
import { repl } from './repl.mjs';
import { $ } from './$.mjs';

const DEFAULT_WATCH_PATTERNS = [
  '**/*.mjs',
  '**/*.js', 
  '**/*.json'
];

export async function dev(options = {}) {
  const {
    watch = DEFAULT_WATCH_PATTERNS,
    repl: startRepl = false,
    cwd = process.cwd(),
    verbose = false
  } = options;

  console.log('🚀 command-stream Development Mode');
  console.log(`📁 Working directory: ${cwd}`);
  console.log(`👀 Watching patterns: ${watch.join(', ')}`);
  
  if (startRepl) {
    console.log('🔧 Starting interactive REPL...\n');
    return await repl();
  } else {
    console.log('💡 Use $.dev({ repl: true }) to start interactive mode');
    console.log('⏳ Development mode active - watching for changes...\n');
    
    // Set up file watching
    const watchers = setupFileWatchers(watch, cwd, verbose);
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping development mode...');
      watchers.forEach(watcher => watcher.close());
      process.exit(0);
    });
    
    return new Promise(() => {}); // Never resolves, dev mode runs until stopped
  }
}

function setupFileWatchers(patterns, cwd, verbose) {
  const watchers = [];
  
  patterns.forEach(pattern => {
    try {
      // Convert glob pattern to directory watching
      const baseDir = getBaseDirectory(pattern);
      const fullPath = path.resolve(cwd, baseDir);
      
      if (fs.existsSync(fullPath)) {
        const watcher = fs.watch(fullPath, { recursive: true }, (eventType, filename) => {
          if (filename && shouldWatchFile(filename, patterns)) {
            const filePath = path.join(fullPath, filename);
            console.log(`📝 ${eventType}: ${path.relative(cwd, filePath)}`);
            
            if (verbose) {
              console.log(`   Event: ${eventType}`);
              console.log(`   File: ${filePath}`);
              console.log(`   Time: ${new Date().toISOString()}`);
            }
          }
        });
        
        watchers.push(watcher);
        
        if (verbose) {
          console.log(`👁️  Watching: ${fullPath}`);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to watch pattern ${pattern}:`, error.message);
    }
  });
  
  return watchers;
}

function getBaseDirectory(pattern) {
  // Extract the base directory from a glob pattern
  const parts = pattern.split('/');
  const baseIndex = parts.findIndex(part => part.includes('*'));
  
  if (baseIndex === -1) {
    return path.dirname(pattern);
  }
  
  return parts.slice(0, baseIndex).join('/') || '.';
}

function shouldWatchFile(filename, patterns) {
  // Simple pattern matching - in a real implementation you'd use a proper glob library
  return patterns.some(pattern => {
    const regex = patternToRegex(pattern);
    return regex.test(filename);
  });
}

function patternToRegex(pattern) {
  // Convert basic glob pattern to regex
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  
  return new RegExp(`^${escaped}$`);
}

// Add $.dev() method to the main $ object
export function addDevMethodTo$($obj) {
  $obj.dev = dev;
  return $obj;
}