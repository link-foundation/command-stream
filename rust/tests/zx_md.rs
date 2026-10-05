//! Port of the zx `test/md.test.ts` suite for `command_stream::zx::transform_markdown`.

use command_stream::zx::transform_markdown;

// zx:test/md.test.ts:21:5:registration
#[test]
fn comments_out_plain_lines() {
    assert_eq!(transform_markdown("\n"), "// \n// ");
}

// zx:test/md.test.ts:25:5:registration
#[test]
fn preserves_indented_blocks_after_blank_line() {
    assert_eq!(transform_markdown("  \n    "), "  \n    ");
}

// zx:test/md.test.ts:29:5:registration
#[test]
fn mid_paragraph_fence_is_not_a_fence() {
    assert_eq!(
        transform_markdown("\n\t~~~js\nconsole.log('js')"),
        "// \n\t~~~js\n// console.log('js')"
    );
}

// zx:test/md.test.ts:40:5:registration
#[test]
fn converts_fenced_blocks() {
    let input = "
# Title
    
~~~js
await $`echo \"js\"`
~~~

typescript code block
~~~~~ts
await $`echo \"ts\"`
~~~~~

~~~
unknown code block
~~~

~~~sh
echo foo
~~~

";
    let expected = "// 
// # Title
//     

await $`echo \"js\"`

// 
// typescript code block

await $`echo \"ts\"`

// 

// unknown code block

// 
await $`
echo foo
`
// 
// ";
    assert_eq!(transform_markdown(input), expected);
}

// zx:test/md.test.ts:85:5:registration
#[test]
fn accepts_fences_indented_up_to_three_spaces() {
    let input = "# h1

paragraph

## h2

### h3

```bash
echo \"1\"
```

### h3

- item 1

   ```bash
   echo \"2\"
   ```

### h3

```bash
echo \"4\"
```
";
    let result = transform_markdown(input);
    assert!(!result.contains("```") && !result.contains("~~~"));
    assert_eq!(result.matches("await $`").count(), 3);
    assert_eq!(result.lines().filter(|l| *l == "`").count(), 3);
    assert!(result.contains("\necho \"2\"\n"));
}

// zx:test/md.test.ts:120:3:registration
#[test]
fn handles_all_line_terminators() {
    let input = "a\r\nb\nc\rd\u{2028}e\u{2029}f";
    assert_eq!(
        transform_markdown(input),
        "// a\n// b\n// c\n// d\n// e\n// f"
    );
}
