export default {
  name: '@command-stream-example/logs',
  version: '1.0.0',
  commands: {
    async *'log-records'({ args }) {
      for (const message of args) {
        yield `${JSON.stringify({ level: message.includes('ERROR') ? 'error' : 'info', message })}\n`;
      }
    },
  },
};
