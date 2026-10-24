export default {
  name: '@command-stream-example/http',
  version: '1.0.0',
  commands: {
    'http-get': async ({ args, abortSignal }) => {
      const response = await fetch(args[0], { signal: abortSignal });
      return {
        code: response.ok ? 0 : 1,
        stdout: await response.text(),
        stderr: response.ok ? '' : `HTTP ${response.status}`,
      };
    },
  },
};
