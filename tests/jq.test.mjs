import { $ } from '../$.mjs';
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