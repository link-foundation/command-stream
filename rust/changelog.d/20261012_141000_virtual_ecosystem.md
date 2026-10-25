---
bump: minor
---

### Added

- Registry-backed virtual command marketplace search with encoded queries,
  bounded result counts, injected transports, and cancellation.
- Idempotent manifest/npm package installation, atomic manifest reload, and
  in-process package watching with explicit shutdown.
- Optional command replacement with restoration on uninstall, plus ten typed
  example packages and ecosystem/enterprise demonstrations.

### Fixed

- Validate package collisions against built-in commands before registry changes.
- Preserve cancellation and capture streamed intermediate stages in composition.
- Preserve externally replaced or extended handlers when uninstalling a package.
- Preserve split UTF-8 process output and interrupt paused output sends on cancellation.
- Give each example integration operation its own bounded deadline, keeping slow
  Git startup independent of the HTTP test and reporting the failing stage.
