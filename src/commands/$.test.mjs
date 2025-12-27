import fs from 'fs';
import { VirtualUtils } from '../$.utils.mjs';

export default async function test({ args }) {
  if (args.length === 0) {
    return { stdout: '', code: 1 };
  }

  const operator = args[0];
  const operand = args[1];

  try {
    switch (operator) {
      case '-e': // File exists
        try {
          fs.statSync(operand);
          return { stdout: '', code: 0 };
        } catch {
          return { stdout: '', code: 1 };
        }

      case '-f': // Regular file
        try {
          const stats = fs.statSync(operand);
          return { stdout: '', code: stats.isFile() ? 0 : 1 };
        } catch {
          return { stdout: '', code: 1 };
        }

      case '-d': // Directory
        try {
          const stats = fs.statSync(operand);
          return { stdout: '', code: stats.isDirectory() ? 0 : 1 };
        } catch {
          return { stdout: '', code: 1 };
        }

      case '-s': // File exists and not empty
        try {
          const stats = fs.statSync(operand);
          return { stdout: '', code: stats.size > 0 ? 0 : 1 };
        } catch {
          return { stdout: '', code: 1 };
        }

      case '-z': // String is empty
        return { stdout: '', code: !operand || operand.length === 0 ? 0 : 1 };

      case '-n': // String is not empty
        return { stdout: '', code: operand && operand.length > 0 ? 0 : 1 };

      default:
        // Simple string test (non-empty)
        return { stdout: '', code: operator && operator.length > 0 ? 0 : 1 };
    }
  } catch (error) {
    return VirtualUtils.error(`test: ${error.message}`);
  }
}
