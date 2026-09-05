# `"format": "console"` makes jscpd analyse zero files

`jscpd`'s `format` option is the list of **languages** to analyse, not the list
of reporters — reporters are configured separately, under `reporters`. A
configuration that sets `"format": "console"` therefore asks jscpd to analyse a
language called `console`, which no file is written in, so the run finds nothing
and exits 0 no matter how much duplication the tree contains.

`@jscpd/finder` selects files with `options.format.includes(format)`, where
`format` is the detected language of the file. `'console'.includes('javascript')`
is `false` for every real language, so every file is filtered out.

## Reproduce

```
node run.mjs
```

The script writes two byte-identical JavaScript files into a temporary
directory and runs jscpd over them twice, with `threshold: 0`:

- `"format": "console"` — no table is printed, no clone is found, exit code 0.
- `"format": ["javascript"]` — 1 clone, 43.75% duplication, exit code 1.

## Where this mattered

`js/.jscpd.json` in this repository carried the broken value, so
`bun run check:duplication` passed over a tree it never read (issue #199). The
same value is still present in
`link-foundation/js-ai-driven-development-pipeline-template`.
