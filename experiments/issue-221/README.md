# Issue 221 production dependency investigation

The published `command-stream@2.0.0` installs ShellJS and its declarations as
runtime dependencies. Both reach `fast-glob`, `micromatch` and vulnerable
`braces`. A runtime depth guard prevents the demonstrated stack overflow but
does not remove the vulnerable package from an npm consumer's dependency graph.

Compare the registry release with a packed checkout:

```sh
node experiments/issue-221/consumer-audit.mjs command-stream@2.0.0
cd js
npm pack --ignore-scripts --pack-destination /tmp
cd ..
node experiments/issue-221/consumer-audit.mjs /tmp/command-stream-2.0.1.tgz
```

The control reports all five packages and six high severity audit findings.
The fixed tarball reports an empty chain and zero vulnerabilities. These clean
consumer audits have no overrides or advisory exceptions.

`js/tests/production-dependencies.test.mjs` failed all three assertions before
the fix. It checks runtime manifests, the production portion of the npm lockfile
and declaration imports. The production-install CI matrix additionally audits
an isolated installation, exercises core commands, ShellJS pipelines and plugins,
and compiles ESM and CommonJS consumers without upstream ShellJS declarations.

The scripts here also preserve the compatibility and bounded input probes:

```sh
node experiments/issue-221/glob-parity.mjs
node --max-old-space-size=64 --stack-size=256 experiments/issue-221/brace-budget.cjs
node --no-experimental-require-module experiments/issue-221/esm-consumer.mjs
bash experiments/issue-221/production-install.sh /tmp/command-stream-2.0.1.tgz /path/to/node/bin omit-optional
```

The local install wrapper hides compilers and Python from the installation PATH
and invokes the same consumer checks as CI; the CI jobs run in clean Node slim
containers. Run the wrapper with `scripts-enabled`, `scripts-disabled` or
`omit-optional`. It tests both local and global installations.

The brace probe uses 15 shallow groups, a 64 MiB heap and a 256 KiB stack; it
checks the 10,000-result expansion limit without allocating the full product.
The ESM probe also passes on Node 22.0.0. The glob comparison uses the pinned
development-only fast-glob engine as the reference; it does not install that
engine in consumers. `vendor-shelljs.mjs` rebuilds the retained, licensed command
source and declarations from the pinned development packages.

The development lockfile still includes braces through repository tooling and
the upstream reference packages. `.github/audit-ignore.txt` describes that
development-only exception; production consumer audits do not use it.
