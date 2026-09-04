#!/usr/bin/env bun

/**
 * Issue #199 — reproduce the npm publish false positive, then show the fix.
 *
 * Run: bun experiments/issue-199-publish-false-positive.mjs
 *
 * Simulates the exact sequence observed in run 33914574283
 * (dev/log/issues/199/pulls/200/ci-logs/run-33914574283.log):
 *
 *   1. `changeset publish` succeeds        -> command-stream@0.20.1 is on npm
 *   2. verification 2s later misses        -> registry replica still answers 404
 *   3. the old loop republishes            -> npm E409 "Cannot publish over
 *                                             previously staged version"
 *   4. E409 matches 'npm error code e'     -> reported as a hard failure
 *
 * The OLD strategy is reimplemented here verbatim so the regression is
 * observable; the NEW strategy is imported from the real module.
 */

import { publishWithRetry } from "../js/scripts/publish-retry.mjs";

const E409_STAGED_OUTPUT = [
  "npm error code E409",
  'npm error 409 Conflict - PUT https://registry.npmjs.org/command-stream - Cannot publish over previously staged version "0.20.1"',
].join("\n");

const FAILURE_PATTERNS = [
  "packages failed to publish",
  "error occurred while publishing",
  "npm error code e",
  "npm error 404",
  "npm error 401",
  "npm error 403",
  "access token expired",
  "eneedauth",
  "exited with code 1",
];

/**
 * A registry that has the version but only reveals it from the Nth read on,
 * mimicking npm's read-replica propagation lag.
 * @param {number} visibleFromRead
 */
function makeLaggingRegistry(visibleFromRead) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    async isPublished() {
      return ++reads >= visibleFromRead;
    },
  };
}

/**
 * `changeset publish`: succeeds once, then answers E409 because the tarball is
 * already staged.
 */
function makePublisher() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async run() {
      calls++;
      if (calls === 1) {
        return {
          code: 0,
          output: "🦋  success packages published successfully",
        };
      }
      return { code: 1, output: E409_STAGED_OUTPUT };
    },
  };
}

/** The pre-#199 algorithm: one verification sample, republish on a miss. */
async function oldStrategy({ publisher, registry, maxRetries = 3 }) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { code, output } = await publisher.run();
    const lower = output.toLowerCase();
    const matched = FAILURE_PATTERNS.find((p) => lower.includes(p));
    if (matched) {
      console.log(
        `  attempt ${attempt}: failed — detected "${matched}" in output`,
      );
      continue;
    }
    if (code !== 0) {
      console.log(`  attempt ${attempt}: failed — exit code ${code}`);
      continue;
    }
    // Single-shot verification, no polling.
    if (await registry.isPublished()) {
      return { success: true, attempts: attempt };
    }
    console.log(
      `  attempt ${attempt}: verification missed, republishing (this is the bug)`,
    );
  }
  return { success: false, attempts: maxRetries };
}

/** The post-#199 algorithm, imported from the shipped module. */
async function newStrategy({ publisher, registry }) {
  return publishWithRetry({
    publish: async () => {
      const { code, output } = await publisher.run();
      return {
        success: code === 0,
        error: code === 0 ? null : new Error(`exit code ${code}`),
        output,
      };
    },
    verify: () => registry.isPublished(),
    maxRetries: 3,
    retryDelay: 0,
    sleepFn: async () => {},
    log: (message) => console.log(`  ${message}`),
    verifyOptions: { attempts: 7, initialDelay: 0, maxDelay: 0 },
  });
}

// The version becomes visible on the 2nd registry read — i.e. the very first
// sample misses, exactly as in the failing CI run.
const VISIBLE_FROM_READ = 2;

console.log("OLD strategy (single-shot verification, republish on a miss):");
const oldPublisher = makePublisher();
const oldResult = await oldStrategy({
  publisher: oldPublisher,
  registry: makeLaggingRegistry(VISIBLE_FROM_READ),
});
console.log(
  `  => success=${oldResult.success}, publish invocations=${oldPublisher.calls}\n`,
);

console.log("NEW strategy (bounded verification polling, no republish):");
const newPublisher = makePublisher();
const newResult = await newStrategy({
  publisher: newPublisher,
  registry: makeLaggingRegistry(VISIBLE_FROM_READ),
});
console.log(
  `  => success=${newResult.success}, publish invocations=${newPublisher.calls}\n`,
);

const reproduced = oldResult.success === false && newResult.success === true;
console.log(
  reproduced
    ? "✅ Reproduced: the old strategy fails a successful release, the new one does not."
    : "❌ Not reproduced.",
);
process.exit(reproduced ? 0 : 1);
