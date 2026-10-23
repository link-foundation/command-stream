# execa 10.2.0 declarations under `exactOptionalPropertyTypes`

Reported upstream as https://github.com/sindresorhus/execa/issues/1265
(body: `upstream-issue.md`). Reproduce in a copy of this directory:

```bash
npm install && npx tsc -p .
```

execa 10.2.0 fails with TS2344 in `types/return/result-all.d.ts`; with
`npm install execa@10.1.1` the same project type-checks. command-stream
re-exports execa's types and checks them with `skipLibCheck: false`, so it
stays on 10.1.1 (see `js/dependency-blockers.json`).
