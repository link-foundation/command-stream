export default {
  name: '@command-stream-example/text',
  version: '1.0.0',
  commands: {
    upper: ({ stdin, args }) => ({
      code: 0,
      stdout: (stdin || args.join(' ')).toUpperCase(),
    }),
  },
};
