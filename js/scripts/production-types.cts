import $ = require('command-stream');
import shell = require('command-stream/shelljs');
import plugin = require('command-stream/shelljs/plugin');
const output: string = shell.head({ '-n': 2 }, ['file.txt']).stdout;
const code: number = $.shelljs.cmd('git').code;
const error: string | null = shell.error();
void [output, code, error];
plugin.register('typedPlugin', () => 'typed');
