export default {
  name: '@command-stream-example/time',
  version: '1.0.0',
  commands: {
    timestamp: () => ({ code: 0, stdout: `${new Date().toISOString()}\n` }),
  },
};
