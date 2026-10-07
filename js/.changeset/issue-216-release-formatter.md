---
'command-stream': patch
---

Pin the Changesets formatter to Prettier so release versioning no longer tries
to run Deno, which the release runner does not have; create the GitHub release
of a version that reached npm without one; make the signal handling tests wait
for the child to be ready instead of sleeping; and run `bun test` in the test
runner examples without a shell, so a checkout path with spaces no longer fails
every file.
