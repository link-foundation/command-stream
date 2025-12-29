#!/usr/bin/env node

// Multiple concurrent event streams

import { $ } from '../js/src/$.mjs';

console.log('Multiple concurrent event streams:');

const $concurrent1 = $({ mirror: false });
const $concurrent2 = $({ mirror: false });
const $concurrent3 = $({ mirror: false });

try {
  console.log('Starting concurrent ping streams...');

  const runners = [
    { runner: $concurrent1`ping -c 3 8.8.8.8`, name: 'Google DNS' },
    { runner: $concurrent2`ping -c 3 1.1.1.1`, name: 'Cloudflare DNS' },
    { runner: $concurrent3`ping -c 3 127.0.0.1`, name: 'Localhost' },
  ];

  const results = {};

  for (const { runner, name } of runners) {
    results[name] = { packets: 0, completed: false };

    runner.on('stdout', (data) => {
      const output = data.toString().trim();
      if (output.includes('bytes from')) {
        results[name].packets++;
        console.log(`🌐 ${name}: packet #${results[name].packets}`);
      }
    });

    runner.on('close', (code) => {
      results[name].completed = true;
      console.log(`✅ ${name}: completed (${results[name].packets} packets)`);
    });
  }

  // Wait for all to complete
  await Promise.all(runners.map(({ runner }) => runner));

  console.log('\n📊 Final results:');
  for (const [name, data] of Object.entries(results)) {
    const status = data.completed ? '✅' : '❌';
    console.log(`${status} ${name}: ${data.packets} packets received`);
  }
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}
