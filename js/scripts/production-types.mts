import { $, shelljs } from 'command-stream';
import shell from 'command-stream/shelljs';
import { register } from 'command-stream/shelljs/plugin';
const output: string = shelljs.head({ '-n': 2 }, ['file.txt']).stdout;
const code: number = $.shelljs.cmd('git').code;
const exists: boolean = shell.test('-f', 'file.txt');
shell.config.globOptions = { globstar: false, braceExpansion: false };
void [output, code, exists];
register('typedPlugin', () => 'typed');
