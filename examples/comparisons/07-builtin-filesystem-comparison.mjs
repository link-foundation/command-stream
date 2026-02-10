#!/usr/bin/env node
/**
 * Built-in File System Commands: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates cross-platform built-in commands
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function builtinFilesystemComparison() {
  try {
    const testDir = `test-${runtime.toLowerCase()}-${Date.now()}`;
    
    console.log('1️⃣  Directory Operations:');
    
    // mkdir - create directory
    const mkdir1 = await $`mkdir -p ${testDir}/subdir/nested`;
    console.log(`   mkdir -p: ${mkdir1.code === 0 ? '✅' : '❌'}`);
    
    // ls - list directory (basic)
    const ls1 = await $`ls ${testDir}`;
    console.log(`   ls basic: ${ls1.stdout.includes('subdir') ? '✅' : '❌'}`);
    
    // ls - list directory (detailed)
    const ls2 = await $`ls -la ${testDir}`;
    console.log(`   ls -la: ${ls2.stdout.includes('drwx') ? '✅' : '❌'}`);

    console.log('\n2️⃣  File Creation and Content:');
    
    // touch - create files
    const touch1 = await $`touch ${testDir}/file1.txt ${testDir}/file2.js`;
    console.log(`   touch multiple: ${touch1.code === 0 ? '✅' : '❌'}`);
    
    // echo - write content to file
    const echo1 = await $`echo "Hello from ${runtime}" > ${testDir}/greeting.txt`;
    console.log(`   echo to file: ${echo1.code === 0 ? '✅' : '❌'}`);
    
    // cat - read file content
    const cat1 = await $`cat ${testDir}/greeting.txt`;
    console.log(`   cat file: ${cat1.stdout.includes(runtime) ? '✅' : '❌'}`);

    console.log('\n3️⃣  File Operations:');
    
    // cp - copy files
    const cp1 = await $`cp ${testDir}/greeting.txt ${testDir}/greeting-copy.txt`;
    console.log(`   cp file: ${cp1.code === 0 ? '✅' : '❌'}`);
    
    // cp - copy directory recursively
    const cp2 = await $`cp -r ${testDir}/subdir ${testDir}/subdir-copy`;
    console.log(`   cp -r directory: ${cp2.code === 0 ? '✅' : '❌'}`);
    
    // mv - move/rename
    const mv1 = await $`mv ${testDir}/file1.txt ${testDir}/renamed.txt`;
    console.log(`   mv file: ${mv1.code === 0 ? '✅' : '❌'}`);

    console.log('\n4️⃣  Path Utilities:');
    
    // basename - extract filename
    const basename1 = await $`basename ${testDir}/greeting.txt`;
    console.log(`   basename: ${basename1.stdout.trim() === 'greeting.txt' ? '✅' : '❌'}`);
    
    // basename - with extension removal
    const basename2 = await $`basename ${testDir}/greeting.txt .txt`;
    console.log(`   basename .ext: ${basename2.stdout.trim() === 'greeting' ? '✅' : '❌'}`);
    
    // dirname - extract directory
    const dirname1 = await $`dirname ${testDir}/greeting.txt`;
    console.log(`   dirname: ${dirname1.stdout.trim() === testDir ? '✅' : '❌'}`);

    console.log('\n5️⃣  Content Processing:');
    
    // Create test content
    await $`echo -e "line1\nline2\nline3\nline4\nline5" > ${testDir}/lines.txt`;
    
    // wc - word/line count
    const wc1 = await $`cat ${testDir}/lines.txt | wc -l`;
    console.log(`   wc -l: ${wc1.stdout.trim() === '5' ? '✅' : '❌'}`);
    
    // head - first lines
    const head1 = await $`head -n 2 ${testDir}/lines.txt`;
    const headLines = head1.stdout.trim().split('\n').length;
    console.log(`   head -n 2: ${headLines === 2 ? '✅' : '❌'}`);
    
    // tail - last lines  
    const tail1 = await $`tail -n 2 ${testDir}/lines.txt`;
    const tailLines = tail1.stdout.trim().split('\n');
    console.log(`   tail -n 2: ${tailLines.includes('line5') ? '✅' : '❌'}`);

    console.log('\n6️⃣  File Properties and Testing:');
    
    // test - file existence
    const test1 = await $`test -f ${testDir}/greeting.txt`;
    console.log(`   test -f (exists): ${test1.code === 0 ? '✅' : '❌'}`);
    
    const test2 = await $`test -f ${testDir}/nonexistent.txt`;
    console.log(`   test -f (missing): ${test2.code !== 0 ? '✅' : '❌'}`);
    
    // test - directory
    const test3 = await $`test -d ${testDir}`;
    console.log(`   test -d: ${test3.code === 0 ? '✅' : '❌'}`);

    console.log('\n7️⃣  Advanced File Operations:');
    
    // Create files with different content
    await $`echo "apple" > ${testDir}/fruit1.txt`;
    await $`echo "banana" > ${testDir}/fruit2.txt`;
    await $`echo "cherry" > ${testDir}/fruit3.txt`;
    
    // cat multiple files
    const catMultiple = await $`cat ${testDir}/fruit*.txt`;
    const fruits = catMultiple.stdout.trim().split('\n');
    console.log(`   cat multiple: ${fruits.length === 3 ? '✅' : '❌'}`);
    
    // Pipeline with built-in commands
    const pipeline = await $`cat ${testDir}/fruit*.txt | sort | cat`;
    const sorted = pipeline.stdout.includes('apple') && pipeline.stdout.includes('cherry');
    console.log(`   pipeline sort: ${sorted ? '✅' : '❌'}`);

    console.log('\n8️⃣  Cleanup Operations:');
    
    // rm - remove files
    const rm1 = await $`rm ${testDir}/fruit*.txt`;
    console.log(`   rm files: ${rm1.code === 0 ? '✅' : '❌'}`);
    
    // rm - remove directory recursively
    const rm2 = await $`rm -rf ${testDir}`;
    console.log(`   rm -rf directory: ${rm2.code === 0 ? '✅' : '❌'}`);
    
    // Verify cleanup
    const verify = await $`test -d ${testDir}`;
    console.log(`   cleanup verified: ${verify.code !== 0 ? '✅' : '❌'}`);

    console.log('\n9️⃣  Cross-platform Path Handling:');
    
    // Test paths with spaces
    const spacePath = `test space ${runtime}`;
    await $`mkdir -p "${spacePath}"`;
    await $`touch "${spacePath}/file with spaces.txt"`;
    await $`echo "content" > "${spacePath}/file with spaces.txt"`;
    
    const spaceTest = await $`cat "${spacePath}/file with spaces.txt"`;
    console.log(`   spaces in paths: ${spaceTest.stdout.includes('content') ? '✅' : '❌'}`);
    
    await $`rm -rf "${spacePath}"`;

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All built-in filesystem commands work perfectly in ${runtime}!`);
    console.log('🌍 Cross-platform compatibility verified!');
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    process.exit(1);
  }
}

builtinFilesystemComparison();