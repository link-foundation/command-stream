// Port of zx test/md.test.ts (issue #26). Test vectors come from
// google/zx (Apache-2.0) at the pinned corpus commit.

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { transformMarkdown } from '../../src/zx/md.mjs';

describe('zx transformMarkdown()', () => {
  describe('root handling', () => {
    test('[zx:test/md.test.ts:21:5:registration] comments out plain lines (including empty line)', () => {
      assert.equal(transformMarkdown('\n'), '// \n// ');
    });

    test('[zx:test/md.test.ts:25:5:registration] preserves tab-indented blocks after a blank line (legacy behavior)', () => {
      assert.equal(transformMarkdown('  \n    '), '  \n    ');
    });

    test('[zx:test/md.test.ts:29:5:registration] does not treat a mid-paragraph fence as a fenced block (legacy behavior)', () => {
      assert.equal(
        transformMarkdown(`
\t~~~js
console.log('js')`),
        `// \n\t~~~js\n// console.log('js')`
      );
    });
  });

  describe('fenced code blocks', () => {
    test('[zx:test/md.test.ts:40:5:registration] converts js/ts to raw code, bash to await $`...` and comments unknown fences', () => {
      // prettier-ignore
      assert.equal(transformMarkdown(`
# Title
    
~~~js
await $\`echo "js"\`
~~~

typescript code block
~~~~~ts
await $\`echo "ts"\`
~~~~~

~~~
unknown code block
~~~

~~~sh
echo foo
~~~

`), `// 
// # Title
//     

await $\`echo "js"\`

// 
// typescript code block

await $\`echo "ts"\`

// 

// unknown code block

// 
await $\`
echo foo
\`
// 
// `)
    });

    test('[zx:test/md.test.ts:85:5:registration] accepts fences indented up to 3 spaces (CommonMark) and converts them', () => {
      const input = `# h1

paragraph

## h2

### h3

\`\`\`bash
echo "1"
\`\`\`

### h3

- item 1

   \`\`\`bash
   echo "2"
   \`\`\`

### h3

\`\`\`bash
echo "4"
\`\`\`
`;
      const result = transformMarkdown(input);

      assert.ok(
        !/```|~~~/.test(result),
        'no raw markdown fences should remain'
      );
      assert.equal((result.match(/await \$`/g) ?? []).length, 3);
      assert.equal((result.match(/^`$/gm) ?? []).length, 3);
    });
  });

  test('[zx:test/md.test.ts:120:3:registration] handles all ECMAScript line terminators', () => {
    const input = 'a\r\nb\nc\rd\u2028e\u2029f';
    const expected = '// a\n// b\n// c\n// d\n// e\n// f';
    assert.equal(transformMarkdown(input), expected);
  });
});
