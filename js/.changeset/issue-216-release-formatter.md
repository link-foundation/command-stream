---
'command-stream': patch
---

Pin the Changesets formatter to Prettier so release versioning no longer tries
to run Deno, which the release runner does not have, and make the signal
handling tests wait for the child to be ready instead of sleeping.
