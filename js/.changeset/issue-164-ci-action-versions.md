---
'command-stream': patch
---

Update the JavaScript release workflow to the action versions used by the
pipeline templates (`actions/checkout@v6`, `actions/setup-node@v6`,
`peter-evans/create-pull-request@v8`), clearing the Node.js 20 deprecation
warnings emitted by GitHub Actions.
