#!/usr/bin/env node

// Test if the ProcessRunner class is working correctly
class TestClass {
  constructor() {
    this.child = null;
  }
  
  get stdout() {
    return this.child ? this.child.stdout : null;
  }
}

const test = new TestClass();
console.log('TestClass stdout:', test.stdout);
console.log('Should be null:', test.stdout === null);

// Now test with actual ProcessRunner
import { $ } from '../src/$.mjs';

const cmd = $`echo "test"`;
console.log('ProcessRunner stdout:', cmd.stdout);
console.log('Should be null:', cmd.stdout === null);

// Check if the object is really a ProcessRunner
console.log('cmd constructor name:', cmd.constructor.name);
console.log('cmd instanceof ProcessRunner:', cmd.constructor.name === 'ProcessRunner');
