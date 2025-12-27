#!/usr/bin/env node

// Test: Mixed quoted and unquoted arguments
// Expected: Each argument properly handled based on its content

import { $ } from '../src/$.mjs';

console.log('=== Test: Mixed Quoting Scenarios ===\n');

async function testMixedQuoting() {
  console.log('1. Multiple interpolations in one command:');
  console.log('------------------------------------------');

  const cmd = 'echo';
  const arg1 = 'hello';
  const arg2 = 'world';
  const arg3 = '$USER';

  const command = $({ mirror: false })`${cmd} ${arg1} ${arg2} ${arg3}`;
  console.log('Inputs:', { cmd, arg1, arg2, arg3 });
  console.log('Generated:', command.spec.command);

  try {
    const result = await command;
    console.log('Output:', String(result).trim());
  } catch (error) {
    console.log('Error:', error.message);
  }

  console.log('\n2. Mix of pre-quoted and unquoted:');
  console.log('-----------------------------------');

  const quotedPath = '"/path with spaces/file.txt"';
  const unquotedPath = 'output.log';

  const mixedCmd = $({ mirror: false })`cat ${quotedPath} > ${unquotedPath}`;
  console.log('Quoted input:', quotedPath);
  console.log('Unquoted input:', unquotedPath);
  console.log('Generated:', mixedCmd.spec.command);

  console.log('\n3. Command construction with various types:');
  console.log('--------------------------------------------');

  const executable = '/usr/bin/env';
  const program = 'node';
  const flag = '--version';
  const envVar = 'NODE_ENV=production';

  const complexCmd = $({
    mirror: false,
  })`${envVar} ${executable} ${program} ${flag}`;
  console.log('Components:', { envVar, executable, program, flag });
  console.log('Generated:', complexCmd.spec.command);

  console.log('\n4. User mixes single and double quotes:');
  console.log('----------------------------------------');

  const singleQuotedArg = "'my-file.txt'";
  const doubleQuotedArg = '"another file.txt"';
  const unquotedArg = 'regular.txt';

  const userMixedCmd = $({
    mirror: false,
  })`ls ${singleQuotedArg} ${doubleQuotedArg} ${unquotedArg}`;
  console.log('Single quoted:', singleQuotedArg);
  console.log('Double quoted:', doubleQuotedArg);
  console.log('Unquoted:', unquotedArg);
  console.log('Generated:', userMixedCmd.spec.command);

  console.log('\n5. Path interpolation positions:');
  console.log('---------------------------------');

  const testPath = '/Users/konard/.claude/local/claude';

  // First position (command)
  const firstPos = $({ mirror: false })`${testPath} --version`;
  console.log('First position:', firstPos.spec.command);

  // Middle position
  const middlePos = $({ mirror: false })`echo ${testPath} done`;
  console.log('Middle position:', middlePos.spec.command);

  // Last position
  const lastPos = $({ mirror: false })`file ${testPath}`;
  console.log('Last position:', lastPos.spec.command);
}

testMixedQuoting().catch(console.error);
