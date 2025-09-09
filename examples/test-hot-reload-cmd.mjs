// Example hot-reloadable command for development
export default async function testHotReload({ args }) {
  const message = args[0] || 'Hello from hot-reloaded command!';
  return {
    stdout: `🔥 HOT RELOAD v1.0: ${message}\n`,
    stderr: '',
    code: 0
  };
}