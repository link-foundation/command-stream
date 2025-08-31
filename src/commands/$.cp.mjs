import fs from 'fs';
import path from 'path';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function cp({ args, stdin, cwd }) {
  const argError = VirtualUtils.validateArgs(args, 2, 'cp');
  if (argError) return VirtualUtils.invalidArgumentError('cp', 'missing destination file operand');

  // Parse flags and paths
  const flags = new Set();
  const paths = [];
  
  for (const arg of args) {
    if (arg === '-r' || arg === '-R' || arg === '--recursive') {
      flags.add('r');
    } else if (arg.startsWith('-')) {
      for (const flag of arg.slice(1)) {
        flags.add(flag);
      }
    } else {
      paths.push(arg);
    }
  }

  if (paths.length < 2) {
    return VirtualUtils.invalidArgumentError('cp', 'missing destination file operand');
  }

  const recursive = flags.has('r') || flags.has('R');
  const sources = paths.slice(0, -1);
  const destination = paths[paths.length - 1];
  
  try {
    const destPath = VirtualUtils.resolvePath(destination, cwd);
    let destExists = false;
    let destIsDir = false;
    
    try {
      const destStats = fs.statSync(destPath);
      destExists = true;
      destIsDir = destStats.isDirectory();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Copying multiple files requires destination to be a directory
    if (sources.length > 1 && destExists && !destIsDir) {
      return VirtualUtils.error(`cp: target '${destination}' is not a directory`);
    }

    // Helper function to copy directory recursively
    const copyRecursive = (src, dest) => {
      const stats = fs.statSync(src);
      
      if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src);
        
        for (const entry of entries) {
          copyRecursive(
            path.join(src, entry),
            path.join(dest, entry)
          );
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    };

    for (const source of sources) {
      const sourcePath = VirtualUtils.resolvePath(source, cwd);
      
      try {
        const sourceStats = fs.statSync(sourcePath);
        let finalDestPath = destPath;
        
        if (destIsDir || (sources.length > 1 && !destExists)) {
          // Copying into a directory
          if (!destExists) {
            fs.mkdirSync(destPath, { recursive: true });
            destIsDir = true;
            destExists = true;
          }
          finalDestPath = path.join(destPath, path.basename(sourcePath));
        }
        
        if (sourceStats.isDirectory()) {
          if (!recursive) {
            return VirtualUtils.error(`cp: -r not specified; omitting directory '${source}'`);
          }
          trace('VirtualCommand', () => `cp: copying directory | ${JSON.stringify({ from: sourcePath, to: finalDestPath }, null, 2)}`);
          copyRecursive(sourcePath, finalDestPath);
        } else {
          trace('VirtualCommand', () => `cp: copying file | ${JSON.stringify({ from: sourcePath, to: finalDestPath }, null, 2)}`);
          fs.copyFileSync(sourcePath, finalDestPath);
        }
        
      } catch (error) {
        if (error.code === 'ENOENT') {
          return VirtualUtils.error(`cp: cannot stat '${source}': No such file or directory`);
        }
        throw error;
      }
    }
    
    trace('VirtualCommand', () => `cp: success | ${JSON.stringify({ filesCopied: sources.length }, null, 2)}`);
    return VirtualUtils.success();
  } catch (error) {
    trace('VirtualCommand', () => `cp: error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`cp: ${error.message}`);
  }
}