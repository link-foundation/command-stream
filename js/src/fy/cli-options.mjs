const FLAGS = {
  '--no-shebang': ['shebang', false],
  '--no-use-m': ['useM', false],
  '--structural': ['structural', true],
  '--commonjs': ['commonjs', true],
  '--help': ['help', true],
  '-h': ['help', true],
};
/** Parse the same explicit options for the standalone and virtual commands. */
export function parseFyArguments(args) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (['--from', '--shell', '--module'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      options[
        { '--from': 'from', '--shell': 'shell', '--module': 'moduleName' }[arg]
      ] = value;
    } else if (Object.hasOwn(FLAGS, arg)) {
      const [name, value] = FLAGS[arg];
      options[name] = value;
    } else if (arg !== '-' && arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 2) {
    throw new Error('Expected input and optional output filename');
  }
  options.filename = positional[0] ?? '';
  return { options, positional };
}

export const FY_USAGE = `$fy - Convert shell scripts and competitor source to command-stream modules

Usage: $fy [options] [input.sh|input.mjs|input.cjs|-] [output.mjs]
Read stdin when no input is given or input is -; print unless output is given.

  --from shell|javascript|zx|execa|shelljs|cross-spawn|bun
  --shell sh|bash|dash|zsh    Interpreter for shell source (default: shebang or sh)
  --module NAME              Target package (default: command-stream)
  --no-use-m                 Import the installed package directly
  --no-shebang               Omit the generated interpreter line
  --commonjs                 Wrap CommonJS source as an ES module
  --structural               Compile the supported shell subset to JS statements
  -h, --help                 Show this help

Shell programs use command-stream + use-m and retain shell semantics.
JavaScript imports migrate to the corresponding command-stream compatibility API.
Output files must not already exist.
`;
