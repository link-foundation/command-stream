# Bounded streaming measurements

Node 26.11.1, Linux, 2026-10-11. Each process ran independently with
`--max-old-space-size=128`, exactly 100,000 lines / 25,600,000 output bytes.
The experiment polls RSS every 5 ms and reports growth relative to the imported
library's baseline. Child output waits for its stdout drain event.

| Mode | Elapsed ms | Baseline RSS bytes | Peak RSS bytes | RSS growth bytes |
| --- | ---: | ---: | ---: | ---: |
| Stream, capture disabled | 873.54 | 84,709,376 | 98,078,720 | 13,369,344 |
| Buffered capture | 952.09 | 84,516,864 | 169,046,016 | 84,529,152 |

This single finite sample used about 6.3 times less additional RSS in streaming
mode. It is a reproducible example, not a general performance guarantee.
Run `experiments/issue-224/stream-memory.mjs stream` and then `buffer` separately.

The native pipeline probe generates exactly 200 chunks of 16 KiB (3,276,800 bytes).
Before the fix Node consumed the whole generator while paused; Bun's stdin writer
also queued all chunks. Afterward Node paused at 45 chunks and Bun at 61 in this
sample, with all bytes delivered after resuming. Counts include OS pipe buffering
and are platform-dependent; the regression asserts less than the finite total,
complete delivery, and no captured output. Legacy result-returning virtual stages
require a completed stdin string and intentionally buffer it.

The independent emulator also handles split UTF-8, split ANSI sequences, alternate
screens and queued-write disposal. The debugger was exercised in Playwright with
Step and Resume, and its [screenshot](../../../../../../../docs/screenshots/pipeline-debugger.png)
is committed for review.
