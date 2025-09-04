import { $ } from './src/$.mjs';

async function getDetailedAuthStatus() {
  try {
    const authResult = await $`gh auth status 2>&1`.run({ capture: true, mirror: false });
    const output = authResult.stdout;
    
    // Parse auth status details
    const details = {
      authenticated: authResult.code === 0,
      loggedInAs: null,
      account: null,
      protocol: null,
      token: null,
      scopes: [],
      hasGistScope: false,
      rawOutput: output // Include raw output for debugging
    };
    
    // Parse logged in account - updated pattern for new format
    const accountMatch = output.match(/Logged in to github\.com account (\S+)|Logged in to [\w\.]+ as (\S+)/);
    if (accountMatch) {
      details.account = accountMatch[1] || accountMatch[2];
    }
    
    // Parse git operations protocol
    const protocolMatch = output.match(/Git operations protocol:\s*(\w+)/);
    if (protocolMatch) {
      details.protocol = protocolMatch[1];
    }
    
    // Parse token (masked)
    const tokenMatch = output.match(/Token:\s*(\S+)/);
    if (tokenMatch) {
      details.token = tokenMatch[1];
    }
    
    // Parse token scopes - handle both quoted and unquoted formats
    const scopesMatch = output.match(/Token scopes:\s*'([^']+)'|Token scopes:\s*([^\n]+)/);
    if (scopesMatch) {
      const scopesStr = scopesMatch[1] || scopesMatch[2];
      // Split by comma and/or quotes, clean up
      details.scopes = scopesStr.split(/[,']/).map(s => s.trim()).filter(s => s && s !== '');
      details.hasGistScope = details.scopes.includes('gist');
    }
    
    // Check if completely logged out
    if (output.includes('You are not logged into any GitHub hosts')) {
      details.authenticated = false;
      details.account = null;
    }
    
    return details;
  } catch (error) {
    return null;
  }
}

// Test it
const status = await getDetailedAuthStatus();
console.log('Auth Status Details:');
console.log(JSON.stringify(status, null, 2));
console.log('\nParsed scopes:', status?.scopes);
console.log('Has gist scope:', status?.hasGistScope);
