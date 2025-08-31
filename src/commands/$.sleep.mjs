import { trace } from '../$.utils.mjs';

export default async function sleep({ args, signal, isCancelled }) {
  const seconds = parseFloat(args[0] || 0);
  trace('VirtualCommand', () => `sleep: starting | ${JSON.stringify({ seconds }, null, 2)}`);
  
  if (isNaN(seconds) || seconds < 0) {
    return { stderr: `sleep: invalid time interval '${args[0]}'`, code: 1 };
  }
  
  // Use abort signal if available, otherwise use setTimeout
  try {
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(resolve, seconds * 1000);
      
      // Handle cancellation via signal
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error('Sleep cancelled'));
        });
      }
      
      // Also check isCancelled periodically for quicker response
      if (isCancelled) {
        const checkInterval = setInterval(() => {
          if (isCancelled()) {
            clearTimeout(timeoutId);
            clearInterval(checkInterval);
            reject(new Error('Sleep cancelled'));
          }
        }, 100);
      }
    });
    
    trace('VirtualCommand', () => `sleep: completed | ${JSON.stringify({ seconds }, null, 2)}`);
    return { stdout: '', code: 0 };
  } catch (err) {
    trace('VirtualCommand', () => `sleep: interrupted | ${JSON.stringify({ seconds, error: err.message }, null, 2)}`);
    // Return SIGTERM exit code when cancelled
    return { stdout: '', code: 143 }; // 128 + 15 (SIGTERM)
  }
}