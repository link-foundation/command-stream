# `$fy` translation fixtures

`sample.sh` is a shell script exercising every construct the `$fy` translator
supports; `sample.mjs` is the module both implementations must produce from it.

Both test suites assert against these files, which is what keeps the JavaScript
and Rust translators byte-for-byte equivalent:

- `js/tests/fy-tool.test.mjs`
- `rust/tests/fy.rs`

Regenerate `sample.mjs` after an intentional change to the rules — either
implementation produces the same bytes, which is the point of the fixture:

```sh
cd rust && cargo run --quiet --example fy_translate -- ../fixtures/fy/sample.sh > ../fixtures/fy/sample.mjs
```

```sh
cd js && bun -e "import {translateShellToMjs} from './src/fy/index.mjs'; import {readFileSync} from 'node:fs'; process.stdout.write(translateShellToMjs(readFileSync('../fixtures/fy/sample.sh','utf8')).code)" > ../fixtures/fy/sample.mjs
```
