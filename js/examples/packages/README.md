# Ten installable command packages

Each directory is an independent npm package with a default export containing
`name`, `version`, and `commands`. They also ship with command-stream's npm
distribution. Install a local module using `$.install('/path/to/index.mjs')`,
or run `npm install /path/to/package` and `$.install(packageName)`.

| Package   | Commands                | Use case                                |
| --------- | ----------------------- | --------------------------------------- |
| git-tools | git-summary, git-recent | Repository automation with literal argv |
| deploy    | deploy-plan             | Streaming deployment planning           |
| files     | file-count              | Directory reports                       |
| json      | json-pretty             | Structured data pipelines               |
| text      | upper                   | Composition and middleware              |
| http      | http-get                | HTTP integrations with cancellation     |
| logs      | log-records             | Online log analytics                    |
| time      | timestamp               | Time-stamped automation                 |
| env       | env-value               | Environment-aware scripts               |
| math      | add                     | Validation and arithmetic               |

Publish from a directory with `npm publish --access public` under a namespace
you own. Retain the `command-stream-command` keyword for marketplace discovery.
These are runnable examples, not a claim of ten independently published
third-party packages. Publication, adoption, and downloads are measured after
release. `../enterprise-workflow.mjs` combines packages, middleware, mocks,
streaming analytics, and a deployment plan without changing a production system.
