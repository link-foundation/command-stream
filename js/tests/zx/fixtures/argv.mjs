#!/usr/bin/env command-stream
// Prints the parsed argv seen through the globals and the module export.
import 'command-stream/zx/globals';
import { argv as importedArgv } from 'command-stream/zx';
/* global argv */

console.log('global', JSON.stringify(argv));
console.log('imported', JSON.stringify(importedArgv));
