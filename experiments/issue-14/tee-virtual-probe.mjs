// Probe: is `tee` resolved as a virtual command? (issue #14)
import { $, listCommands, enableVirtualCommands } from '../../js/src/$.mjs';

console.log('registered:', listCommands().includes('tee'));
enableVirtualCommands();

const which = await $({ mirror: false })`which tee`;
console.log('which tee:', JSON.stringify(which.stdout));

const unknown = await $({
  stdin: 'test',
  mirror: false,
})`tee --unknown-option file.txt`;
console.log('unknown option:', JSON.stringify(unknown));
