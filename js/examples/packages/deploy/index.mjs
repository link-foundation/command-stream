export default {
  name: '@command-stream-example/deploy',
  version: '1.0.0',
  commands: {
    async *'deploy-plan'({ args }) {
      const [environment = 'staging', revision = 'HEAD'] = args;
      yield `Validate ${revision}\n`;
      yield `Build artifact for ${environment}\n`;
      yield `Deploy after approval\n`;
    },
  },
};
