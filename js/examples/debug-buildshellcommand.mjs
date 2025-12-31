#!/usr/bin/env node

// Debug buildShellCommand function to see exactly what it produces
import fs from 'fs';

// Recreate buildShellCommand logic
function quote(value) {
  if (value === null || value === undefined) {
    return '""';
  }

  const str = String(value);
  if (str === '') {
    return '""';
  }

  // Check if value needs quoting (contains spaces or special characters)
  if (/^[a-zA-Z0-9._/:-]+$/.test(str)) {
    return str; // Safe to use unquoted
  }

  return `'${str.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(strings, values) {
  console.log('buildShellCommand input:', { strings, values });

  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (
        v &&
        typeof v === 'object' &&
        Object.prototype.hasOwnProperty.call(v, 'raw')
      ) {
        console.log(`Using raw value: ${String(v.raw)}`);
        out += String(v.raw);
      } else {
        const quoted = quote(v);
        console.log(`Quoting value: "${v}" -> "${quoted}"`);
        out += quoted;
      }
    }
  }

  console.log('buildShellCommand output:', out);
  return out;
}

console.log('=== buildShellCommand Debug ===');

console.log('\n--- Case 1: Template literal $`echo hello` ---');
const strings1 = ['echo hello'];
const values1 = [];
const result1 = buildShellCommand(strings1, values1);

console.log(
  '\n--- Case 2: String interpolation $`${cmd}` where cmd="echo hello" ---'
);
const strings2 = ['', ''];
const values2 = ['echo hello'];
const result2 = buildShellCommand(strings2, values2);

console.log(
  '\n--- Case 3: String interpolation $`echo ${arg}` where arg="hello" ---'
);
const strings3 = ['echo ', ''];
const values3 = ['hello'];
const result3 = buildShellCommand(strings3, values3);

console.log('\n--- Case 4: Multiple args $`echo ${arg1} ${arg2}` ---');
const strings4 = ['echo ', ' ', ''];
const values4 = ['hello', 'world'];
const result4 = buildShellCommand(strings4, values4);

console.log('\n=== Summary ===');
console.log(`Case 1 (template): "${result1}"`);
console.log(`Case 2 (interpolation): "${result2}"`);
console.log(`Case 3 (mixed): "${result3}"`);
console.log(`Case 4 (multiple): "${result4}"`);
