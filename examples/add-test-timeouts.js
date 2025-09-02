#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Files that need timeouts added
const filesWithoutTimeouts = [
  'bun.features.test.mjs',
  'execa.features.test.mjs', 
  'options-examples.test.mjs',
  'options-syntax.test.mjs',
  'pipe.test.mjs',
  'readme-examples.test.mjs',
  'shell-settings.test.mjs',
  'start-run-edge-cases.test.mjs',
  'start-run-options.test.mjs',
  'sync.test.mjs',
  'system-pipe.test.mjs',
  'text-method.test.mjs',
  'zx.features.test.mjs'
];

filesWithoutTimeouts.forEach(filename => {
  const filepath = path.join('tests', filename);
  console.log(`Processing ${filename}...`);
  
  let content = fs.readFileSync(filepath, 'utf8');
  let modified = false;
  
  // Match test() or it() calls and add timeout if not present
  // Matches patterns like:
  // test('description', () => { ... });
  // test('description', async () => { ... });
  // it('description', () => { ... });
  // it('description', async () => { ... });
  
  // Look for test/it calls that end with }); and don't have a timeout
  content = content.replace(
    /(\b(?:test|it)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[^}]*\})\s*\);/g,
    (match, testBody) => {
      // Check if this already has a timeout (ends with }, number);)
      if (match.match(/\}\s*,\s*\d+\s*\);$/)) {
        return match; // Already has timeout
      }
      modified = true;
      // Add 30 second timeout
      return testBody + ', 30000);';
    }
  );
  
  // Also handle multiline test definitions
  // This is more complex, so we'll use a different approach
  const lines = content.split('\n');
  const newLines = [];
  let inTest = false;
  let braceCount = 0;
  let testStartLine = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if we're starting a test/it block
    if (!inTest && line.match(/^\s*(?:test|it)\s*\(/)) {
      inTest = true;
      testStartLine = i;
      braceCount = 0;
    }
    
    if (inTest) {
      // Count braces
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      
      // Check if test block is complete
      if (braceCount === 0 && line.includes('});')) {
        // Check if it already has a timeout
        if (!line.match(/\}\s*,\s*\d+\s*\);/)) {
          // Add timeout
          newLines.push(line.replace(/\}\s*\);/, '}, 30000);'));
          modified = true;
        } else {
          newLines.push(line);
        }
        inTest = false;
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }
  
  if (modified) {
    fs.writeFileSync(filepath, newLines.join('\n'), 'utf8');
    console.log(`  ✓ Added timeouts to ${filename}`);
  } else {
    console.log(`  - No changes needed for ${filename}`);
  }
});

console.log('Done!');