# Current requirement audit

Read issue #30 and every discussion comment, inline comment and review on
PR #116. Issue comments, inline comments and reviews are empty. No required
sub-issues are referenced. Review feedback requires full tests/docs, removal
of parity-exempt, both languages, conflict resolution, and a competitor review.

## Implementation acceptance criteria

The public [comparison and evidence matrix](../../../../../../../../docs/VIRTUAL-COMMAND-COMPARISON.md)
maps every planned capability to tests in both languages. Both ecosystem guides
document signatures, constraints, errors and runnable examples. The implementation
includes packages, composition/inheritance, async producers, middleware/plugins,
typed interfaces, development reload, install/create/extend and real registry
search. The ten-package examples cover Git, files, deployment, JSON, text, HTTP,
logs, time, environment and math. Enterprise demonstrations validate configuration,
stream deployment plans and apply audit middleware without production mutations.

The PR has no labels, so parity-exempt is absent. Existing release fragments
prepare a JS patch and a Rust minor release against main's current versions.

## Conflicts and reproducible regression

Current main is 5e58fc7 (Rust 1.12.0; JS 2.6.0). Conflicts affect the full JS
entry, package registry, and Rust README. Main extracted the shell API into
core.mjs and command-registry.mjs. Keeping the obsolete implementations in the
old files would duplicate registry exports and discard the lightweight entry.
Resolution retains main's module graph, both README additions, and moves the
two validation changes into the shared core and registry.

The pre-fix merged tree reproduces all six invalid-name cases, each returning
a configured tag instead of throwing. See shared-core-before.log, lines 19–99.
The focused suite now checks full/core ESM/CommonJS and direct registration,
with registry state unchanged after each rejection. The finite experiment also
runs with Node and Bun. Main's configured command builder options are preserved.

## Competitor review

Current official documentation confirms that ShellJS has third-party plugins,
Dax registers custom commands, Execa supports generator transforms, zx supplies
process hooks/streams, Bun offers JS shell interop, and cmd_lib supports custom
Rust commands. The comparison credits those capabilities and links the existing
complete JS/Rust competitor inventories. The distinguishing implementation is
the integrated lifecycle with discovery, validation, restoration, middleware,
bounded streaming and atomic reload in both languages. Universal superiority
over every project cannot be inferred from API coverage or passing tests.
The generated feature catalog's blanket absence claims are also corrected to
credit ShellJS npm plugins, zx hooks and Execa generator transforms; regenerating
the site keeps the detailed comparison and feature pages consistent.

## External outcomes: blocked or unverified

- Registry discovery at 2026-10-24T20:53:46Z returned zero packages carrying
  command-stream-command, recorded in registry-discovery.json. This keyword
  query does not prove that no untagged packages exist, but it cannot verify
  the requested ten independently published discoverable packages.
- npm whoami against registry.npmjs.org returns ENEEDAUTH; npm-auth.log records
  the exact failure. No registry publishing identity or namespace ownership is
  available here. The examples are installable and publication-ready; they are
  not independently published by this PR's main-library release pipeline.
- External developer adoption and enterprise production usage cannot be created
  or verified by local tests. Runnable enterprise examples establish workflows.
- Being better than all existing competitors is unverified. The evidence supports
  the documented feature combination, with explicit limits for specialized APIs,
  performance and adoption.

These outcomes remain unfinished and must not be reported as complete. Leave
PR #116 unmerged; retain Fixes #30 as requested without treating it as evidence
that these success metrics have been met.
