
#!/usr/bin/env node
let sigintReceived = false;
process.on('SIGINT', () => {
  console.log('CHILD_SIGINT_RECEIVED');
  sigintReceived = true;
  process.exit(130);
});

// Keep running until interrupted
console.log('CHILD_STARTED');
setInterval(() => {
  if (!sigintReceived) {
    console.log('CHILD_RUNNING');
  }
}, 100);
