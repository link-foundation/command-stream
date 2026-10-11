export default {
  name: '@command-stream-example/env',
  version: '1.0.0',
  commands: {
    'env-value': ({ args, env = process.env }) => ({
      code: env[args[0]] === undefined ? 1 : 0,
      stdout: `${env[args[0]] ?? ''}\n`,
    }),
  },
};
