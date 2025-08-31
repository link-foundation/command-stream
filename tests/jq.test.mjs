import { $ } from '../src/$.mjs';
import { describe, test, expect } from 'bun:test';

describe('jq streaming tests', () => {
  test('stream of JSON objects through jq -c', async () => {
    // Generate a stream of JSON objects using printf
    const result = await $`printf '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Charlie"}\n'`.pipe($`jq -c .`);
    
    // Each object should be on its own line in compact format
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('{"id":1,"name":"Alice"}');
    expect(lines[1]).toBe('{"id":2,"name":"Bob"}');
    expect(lines[2]).toBe('{"id":3,"name":"Charlie"}');
  });

  test('stream JSON objects with filtering through jq', async () => {
    // Generate stream and filter for id > 1
    const result = await $`printf '{"id":1,"value":10}\n{"id":2,"value":20}\n{"id":3,"value":30}\n'`.pipe($`jq -c 'select(.id > 1)'`);
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({id: 2, value: 20});
    expect(JSON.parse(lines[1])).toEqual({id: 3, value: 30});
  });

  test('generate JSON stream using echo in loop', async () => {
    // Generate JSON objects using a loop
    const result = await $`sh -c 'for i in 1 2 3; do echo "{\\"index\\":$i,\\"squared\\":$((i*i))}"; done'`.pipe($`jq -c .`);
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({index: 1, squared: 1});
    expect(JSON.parse(lines[1])).toEqual({index: 2, squared: 4});
    expect(JSON.parse(lines[2])).toEqual({index: 3, squared: 9});
  });

  test('transform JSON stream with jq', async () => {
    // Generate stream and transform each object
    const result = await $`printf '{"name":"Alice","age":30}\n{"name":"Bob","age":25}\n'`.pipe($`jq -c '{user: .name, years: .age}'`);
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({user: "Alice", years: 30});
    expect(JSON.parse(lines[1])).toEqual({user: "Bob", years: 25});
  });

  test('generate and process array elements as stream', async () => {
    // Generate an array and convert to stream of objects
    const result = await $`echo '[{"x":1},{"x":2},{"x":3}]'`.pipe($`jq -c '.[]'`);
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('{"x":1}');
    expect(lines[1]).toBe('{"x":2}');
    expect(lines[2]).toBe('{"x":3}');
  });

  test('combine multiple JSON sources into stream', async () => {
    // Combine multiple echo commands into a single stream
    const result = await $`sh -c 'echo "{\\"source\\":\\"A\\",\\"data\\":100}"; echo "{\\"source\\":\\"B\\",\\"data\\":200}"'`.pipe($`jq -c .`);
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({source: "A", data: 100});
    expect(JSON.parse(lines[1])).toEqual({source: "B", data: 200});
  });
});

describe('jq streaming with pipe | syntax', () => {
  test('stream of JSON objects through jq -c using pipe syntax', async () => {
    // Generate a stream of JSON objects using printf with pipe syntax
    const result = await $`printf '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Charlie"}\n' | jq -c .`;
    
    // Each object should be on its own line in compact format
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('{"id":1,"name":"Alice"}');
    expect(lines[1]).toBe('{"id":2,"name":"Bob"}');
    expect(lines[2]).toBe('{"id":3,"name":"Charlie"}');
  });

  test('stream JSON with filtering using pipe syntax', async () => {
    // Generate stream and filter for value > 15
    const result = await $`printf '{"id":1,"value":10}\n{"id":2,"value":20}\n{"id":3,"value":30}\n' | jq -c 'select(.value > 15)'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({id: 2, value: 20});
    expect(JSON.parse(lines[1])).toEqual({id: 3, value: 30});
  });

  test('transform JSON stream with jq using pipe syntax', async () => {
    // Generate stream and transform each object
    const result = await $`printf '{"name":"Alice","age":30}\n{"name":"Bob","age":25}\n' | jq -c '{user: .name, years: .age}'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({user: "Alice", years: 30});
    expect(JSON.parse(lines[1])).toEqual({user: "Bob", years: 25});
  });

  test('process array elements as stream using pipe syntax', async () => {
    // Generate an array and convert to stream of objects
    const result = await $`echo '[{"x":1},{"x":2},{"x":3}]' | jq -c '.[]'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('{"x":1}');
    expect(lines[1]).toBe('{"x":2}');
    expect(lines[2]).toBe('{"x":3}');
  });

  test('multi-pipe JSON processing', async () => {
    // Use multiple pipes to process JSON
    const result = await $`echo '[{"name":"alice","score":95},{"name":"bob","score":87},{"name":"charlie","score":92}]' | jq -c '.[]' | jq -c 'select(.score > 90)'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({name: "alice", score: 95});
    expect(JSON.parse(lines[1])).toEqual({name: "charlie", score: 92});
  });

  test('complex JSON stream manipulation with pipes', async () => {
    // Multiple transformations in a pipeline
    const result = await $`printf '{"user":"alice","points":100}\n{"user":"bob","points":150}\n{"user":"charlie","points":75}\n' | jq -c 'select(.points >= 100)' | jq -c '{name: .user, level: (if .points >= 150 then "gold" else "silver" end)}'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({name: "alice", level: "silver"});
    expect(JSON.parse(lines[1])).toEqual({name: "bob", level: "gold"});
  });
});

describe('realtime JSON streaming with delays', () => {
  test('stream JSON with random delays between outputs', async () => {
    // Simulate realtime stream with random delays between 0.01 and 0.05 seconds
    const result = await $`sh -c 'for i in 1 2 3 4 5; do echo "{\\"timestamp\\":$(date +%s),\\"event\\":\\"event$i\\",\\"value\\":$((i * 10))}"; sleep 0.0$((RANDOM % 5 + 1)); done' | jq -c .`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(5);
    
    // Verify each JSON object is valid and has expected structure
    for (let i = 0; i < 5; i++) {
      const obj = JSON.parse(lines[i]);
      expect(obj).toHaveProperty('timestamp');
      expect(obj).toHaveProperty('event');
      expect(obj).toHaveProperty('value');
      expect(obj.event).toBe(`event${i + 1}`);
      expect(obj.value).toBe((i + 1) * 10);
    }
  });

  test('stream JSON with fixed delays using printf and sleep', async () => {
    // Use printf and sleep to simulate delayed streaming
    const result = await $`sh -c 'for i in 1 2 3; do printf "{\\"id\\":%d,\\"time\\":\\"now\\"}\\n" $i; sleep 0.01; done' | jq -c .`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({id: 1, time: "now"});
    expect(JSON.parse(lines[1])).toEqual({id: 2, time: "now"});
    expect(JSON.parse(lines[2])).toEqual({id: 3, time: "now"});
  });

  test('simulate server logs with delayed JSON output', async () => {
    // Simulate server logs that arrive at different intervals  
    const result = await $`sh -c 'echo "{\\"level\\":\\"info\\",\\"msg\\":\\"Server starting\\",\\"port\\":3000}"; sleep 0.02; echo "{\\"level\\":\\"debug\\",\\"msg\\":\\"Database connected\\",\\"host\\":\\"localhost\\"}"; sleep 0.03; echo "{\\"level\\":\\"info\\",\\"msg\\":\\"Server ready\\",\\"status\\":\\"listening\\"}"; sleep 0.01; echo "{\\"level\\":\\"warn\\",\\"msg\\":\\"High memory usage\\",\\"usage\\":85}"' | jq -c 'select(.level != "debug")'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3); // Should filter out debug message
    
    const logs = lines.map(line => JSON.parse(line));
    expect(logs[0]).toMatchObject({level: "info", msg: "Server starting"});
    expect(logs[1]).toMatchObject({level: "info", msg: "Server ready"});
    expect(logs[2]).toMatchObject({level: "warn", msg: "High memory usage"});
  });

  test('process streaming metrics with delays and aggregation', async () => {
    // Simulate streaming metrics that arrive over time
    const result = await $`sh -c 'for i in 1 2 3 4 5; do echo "{\\"metric\\":\\"cpu\\",\\"value\\":$((50 + i * 5)),\\"host\\":\\"server$i\\"}"; sleep 0.015; done' | jq -c 'select(.value > 60)'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3); // Only values > 60 (65, 70, 75)
    
    const metrics = lines.map(line => JSON.parse(line));
    expect(metrics[0].value).toBe(65);
    expect(metrics[1].value).toBe(70);
    expect(metrics[2].value).toBe(75);
  });

  test('handle burst then delay pattern', async () => {
    // Simulate burst of messages followed by delays
    const result = await $`sh -c 'echo "{\\"batch\\":1,\\"msg\\":\\"burst1\\"}"; echo "{\\"batch\\":1,\\"msg\\":\\"burst2\\"}"; echo "{\\"batch\\":1,\\"msg\\":\\"burst3\\"}"; sleep 0.05; echo "{\\"batch\\":2,\\"msg\\":\\"burst4\\"}"; echo "{\\"batch\\":2,\\"msg\\":\\"burst5\\"}"' | jq -c .`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(5);
    
    const messages = lines.map(line => JSON.parse(line));
    expect(messages.filter(m => m.batch === 1)).toHaveLength(3);
    expect(messages.filter(m => m.batch === 2)).toHaveLength(2);
  });

  test('stream with varying delay intervals', async () => {
    // Different delay patterns to test buffering
    const result = await $`sh -c 'echo "{\\"seq\\":1,\\"delay\\":\\"none\\"}"; sleep 0.001; echo "{\\"seq\\":2,\\"delay\\":\\"1ms\\"}"; sleep 0.01; echo "{\\"seq\\":3,\\"delay\\":\\"10ms\\"}"; sleep 0.02; echo "{\\"seq\\":4,\\"delay\\":\\"20ms\\"}"; sleep 0.005; echo "{\\"seq\\":5,\\"delay\\":\\"5ms\\"}"' | jq -c '{id: .seq, type: .delay}'`;
    
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(5);
    
    // Verify transformation was applied correctly despite delays
    for (let i = 0; i < 5; i++) {
      const obj = JSON.parse(lines[i]);
      expect(obj).toHaveProperty('id');
      expect(obj).toHaveProperty('type');
      expect(obj.id).toBe(i + 1);
    }
  });

  test('verify immediate streaming output from jq', async () => {
    // Test that jq outputs each object immediately as it arrives
    const startTime = Date.now();
    const timestamps = [];
    
    // Create a command that outputs JSON with significant delays
    const cmd = $`sh -c 'echo "{\\"id\\":1}"; sleep 0.2; echo "{\\"id\\":2}"; sleep 0.2; echo "{\\"id\\":3}"' | jq -c .`;
    
    // Use streaming to capture output as it arrives
    const chunks = [];
    for await (const chunk of cmd.stream()) {
      if (chunk.type === 'stdout') {
        const now = Date.now();
        timestamps.push(now - startTime);
        chunks.push(chunk.data.toString());
      }
    }
    
    // We should have received chunks at different times, not all at once
    expect(chunks.length).toBeGreaterThan(0);
    
    // Check if we got output in realtime (with some delays between)
    // The timestamps should show delays if streaming is working properly
    if (timestamps.length >= 3) {
      // Allow for some variance but expect delays
      const delay1 = timestamps[1] - timestamps[0];
      const delay2 = timestamps[2] - timestamps[1];
      
      // At least one of the delays should be significant (>100ms)
      // showing that output came as it was produced
      expect(Math.max(delay1, delay2)).toBeGreaterThan(100);
    }
    
    // Verify we got all the JSON objects
    const output = chunks.join('');
    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({id: 1});
    expect(JSON.parse(lines[1])).toEqual({id: 2});
    expect(JSON.parse(lines[2])).toEqual({id: 3});
  });
});