const testOutput = "Token scopes: 'gist', 'read:org', 'repo'";

// Try the current regex
const scopesMatch = testOutput.match(/Token scopes:\s*'([^']+)'|Token scopes:\s*([^\n]+)/);
console.log('Match result:', scopesMatch);

if (scopesMatch) {
  const scopesStr = scopesMatch[1] || scopesMatch[2];
  console.log('Captured string:', scopesStr);
  
  // The issue: we're only capturing the first quoted item
  // We need to capture the entire line after "Token scopes:"
}

// Better approach - capture everything after Token scopes:
const betterMatch = testOutput.match(/Token scopes:\s*(.+)/);
console.log('\nBetter match:', betterMatch);
if (betterMatch) {
  const scopesLine = betterMatch[1];
  console.log('Full scopes line:', scopesLine);
  
  // Extract all quoted strings
  const scopes = scopesLine.match(/'([^']+)'/g);
  console.log('All quoted strings:', scopes);
  
  // Clean them up
  const cleanScopes = scopes ? scopes.map(s => s.replace(/'/g, '')) : [];
  console.log('Clean scopes:', cleanScopes);
}
