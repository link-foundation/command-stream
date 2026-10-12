export default {
  name: '@command-stream-example/math',
  version: '1.0.0',
  commands: {
    add: ({ args }) =>
      args.some((value) => !Number.isFinite(Number(value)))
        ? { code: 1, stderr: 'Expected finite numbers' }
        : {
            code: 0,
            stdout: `${args.reduce((sum, value) => sum + Number(value), 0)}\n`,
          },
  },
};
