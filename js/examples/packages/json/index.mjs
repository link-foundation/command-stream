export default {
  name: '@command-stream-example/json',
  version: '1.0.0',
  commands: {
    'json-pretty': ({ stdin, args }) => ({
      code: 0,
      stdout: `${JSON.stringify(JSON.parse(stdin || args[0] || '{}'), null, 2)}\n`,
    }),
  },
};
