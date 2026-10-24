// Preserve cross-spawn's callable default and sync method during migration.
import spawn from 'cross-spawn';
export default spawn;
export { spawn };
export const sync = spawn.sync;
