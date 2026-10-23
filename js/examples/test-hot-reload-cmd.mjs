// Install this module with $.install(), then pass its handle to $.dev().
export default {
  name: 'hot-reload-example',
  version: '1.0.0',
  commands: {
    'hot-demo': ({ args }) => ({
      code: 0,
      stdout: `Reloadable greeting: ${args[0] ?? 'world'}\n`,
    }),
  },
};
