#!/usr/bin/env node

// Interactive command simulation with events

import { $ } from '../src/$.mjs';

console.log('Interactive command simulation:');
const $interactive = $({ stdin: 'John\n25\nDeveloper\ny\n', mirror: false });

try {
  const interactiveScript = `
echo "Please enter your name:"
read name
echo "Hello $name!"
echo "Please enter your age:"
read age
echo "You are $age years old."
echo "Please enter your job:"
read job
echo "So you work as a $job."
echo "Is this correct? (y/n):"
read confirm
if [ "$confirm" = "y" ]; then
  echo "Profile saved successfully!"
else
  echo "Profile cancelled."
fi
`;

  const runner = $interactive`bash -c '${interactiveScript}'`;

  let questionCount = 0;
  let responseCount = 0;

  runner.on('stdout', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    for (const line of lines) {
      if (line.includes('Please enter') || line.includes('Is this correct')) {
        questionCount++;
        console.log(`❓ Question #${questionCount}: ${line}`);
      } else if (
        line.includes('Hello') ||
        line.includes('You are') ||
        line.includes('So you work')
      ) {
        responseCount++;
        console.log(`💬 Response #${responseCount}: ${line}`);
      } else if (
        line.includes('Profile saved') ||
        line.includes('Profile cancelled')
      ) {
        console.log(`✅ Result: ${line}`);
      }
    }
  });

  runner.on('close', (code) => {
    console.log(
      `📝 Interactive session completed: ${questionCount} questions, ${responseCount} responses`
    );
  });

  await runner;
} catch (error) {
  console.log(`Error: ${error.message}`);
}
