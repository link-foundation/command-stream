#!/usr/bin/env node

// Network monitoring with multiple hosts using events

import { $ } from '../src/$.mjs';

console.log('Network monitoring with multiple hosts:');

const hosts = ['google.com', 'github.com', 'stackoverflow.com'];
const $networkMonitors = hosts.map(() => $({ mirror: false }));

try {
  console.log('Starting network monitoring...');

  const hostResults = new Map();
  const promises = [];

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const monitor = $networkMonitors[i];
    const runner = monitor`ping -c 3 ${host}`;

    hostResults.set(host, { packets: 0, avgTime: 0, times: [] });

    runner.on('stdout', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
      for (const line of lines) {
        if (line.includes('bytes from')) {
          const timeMatch = line.match(/time=([0-9.]+)/);
          if (timeMatch) {
            const time = parseFloat(timeMatch[1]);
            const result = hostResults.get(host);
            result.packets++;
            result.times.push(time);
            console.log(`🌐 ${host}: packet #${result.packets} (${time}ms)`);
          }
        }
      }
    });

    runner.on('close', (code) => {
      const result = hostResults.get(host);
      if (result.times.length > 0) {
        result.avgTime = (
          result.times.reduce((a, b) => a + b, 0) / result.times.length
        ).toFixed(2);
      }
      console.log(`✅ ${host}: monitoring complete (avg: ${result.avgTime}ms)`);
    });

    promises.push(runner);
  }

  await Promise.all(promises);

  console.log('\n📊 Network monitoring summary:');
  for (const [host, result] of hostResults) {
    const status = result.packets > 0 ? '🟢' : '🔴';
    console.log(
      `${status} ${host}: ${result.packets} packets, avg ${result.avgTime}ms`
    );
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
