import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function _write_multiline_content({ args, cwd }) {
  trace('VirtualCommand', () => `_write_multiline_content: processing | ${JSON.stringify({ argsCount: args.length }, null, 2)}`);

  if (args.length < 2) {
    return VirtualUtils.error('_write_multiline_content: requires filename and base64 content');
  }

  const filename = args[0];
  const base64Content = args[1];

  try {
    // Decode the base64 content
    const content = Buffer.from(base64Content, 'base64').toString('utf8');
    
    // Resolve the file path
    const resolvedPath = VirtualUtils.resolvePath(filename, cwd);
    
    // Write the content to file
    fs.writeFileSync(resolvedPath, content);
    
    trace('VirtualCommand', () => `_write_multiline_content: success | ${JSON.stringify({ 
      file: filename, 
      contentLength: content.length 
    }, null, 2)}`);
    
    return VirtualUtils.success();
  } catch (error) {
    trace('VirtualCommand', () => `_write_multiline_content: error | ${JSON.stringify({ error: error.message }, null, 2)}`);
    return VirtualUtils.error(`_write_multiline_content: ${error.message}`);
  }
}