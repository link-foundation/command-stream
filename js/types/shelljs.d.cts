import upstream = require('shelljs');

/** ShellJS 0.10 helpers corrected from the older upstream declarations. */
declare const shelljs: Omit<typeof upstream, 'error' | 'tempdir' | 'cmd'> & {
  error(): string | null;
  errorCode(): number | null;
  tempdir(): string;
  cmd(program: string): upstream.ShellString;
  cmd(
    program: string,
    ...args: [...string[], string | upstream.CmdOptions]
  ): upstream.ShellString;
};
export = shelljs;
