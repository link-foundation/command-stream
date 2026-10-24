#!/usr/bin/env node
import { use } from 'use-m';
const { command } = await use("command-stream");
const source = "#!/bin/sh\n# deploy helper\nset -e\n\nTARGET=${1:-staging}\nexport REGION=eu\n\ndeploy() {\n  local tag\n  tag=\"$(git rev-parse --short HEAD)\"\n  echo \"deploying $tag to $TARGET\" | tee deploy.log\n}\n\nif [ -d dist ]; then\n  deploy\nelse\n  echo \"nothing to deploy\" >&2\nfi\n\nfor env in staging prod; do\n  echo \"$env\"\ndone\n\ncase \"$TARGET\" in\n  staging) deploy ;;\n  *) echo unknown ;;\nesac\n\nls && echo ok || echo failed\nexit 0\n";
const result = await command("sh", '-c', source, "translated.sh", ...process.argv.slice(2))
  .with({ mirror: true, capture: false, stdin: 'inherit' }).run();
process.exitCode = result.code;
