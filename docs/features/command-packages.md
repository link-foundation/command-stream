# Compose and extend virtual commands

Typed command packages support registration, composition, middleware, inheritance and atomic reload.

**Category:** Your own commands

**Languages:** JavaScript, Rust

## JavaScript

**API:** `create`, `install`, `compose`, `extend`, `inherit`

**Verified in:** Node.js, Bun

### Example

[`js/examples/features/command-packages.mjs`](https://github.com/link-foundation/command-stream/blob/main/js/examples/features/command-packages.mjs)

```js
import $, { compose } from '../../src/$.mjs';
import { example, makeTempDir } from './_harness.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
await example(
  { id: 'command-packages', title: 'Compose and extend virtual commands' },
  async ({ record }) => {
    $.create('package-hello', ({ args }) => ({
      code: 0,
      stdout: args.join(' '),
    }));
    try {
      $.inherit('package-greet', 'package-hello', { args: ['hello'] });
      $.extend('package-greet', async (context, next) => {
        const result = await next(context);
        return { ...result, stdout: `${result.stdout}!` };
      });
      record(
        'inherited middleware',
        await (await $({ mirror: false })`package-greet world`).text()
      );
      let rejected = 0;
      for (const name of [
        '',
        'two words',
        '7command',
        'command;echo',
        'écho',
        'line\n',
      ]) {
        try {
          $.create(name, () => ({ code: 0 }));
        } catch {
          rejected++;
        }
      }
      record('invalid names rejected', rejected);
      $.create(
        'package-pipeline',
        compose(
          async function* () {
            yield 'one\n';
            yield 'two\n';
          },
          ({ stdin }) => ({
            code: 7,
            stdout: stdin.toUpperCase(),
            stderr: 'stop',
          }),
          () => {
            throw new Error('continued after failure');
          }
        )
      );
      const result = await $({
        mirror: false,
        errexit: false,
      })`package-pipeline`;
      record('streamed composition', [
        result.code,
        await result.text(),
        result.stderr.toString(),
      ]);

      const file = join(makeTempDir('command-package'), 'commands.mjs');
      const definition = (version, commands) =>
        `export default {name:'parity-package',version:'${version}',commands:{${commands}}};`;
      await writeFile(
        file,
        definition('1', "'package-installed':()=>({code:0,stdout:'one'})")
      );
      const installed = await $.install(file, { install: false });
      try {
        const idempotent =
          (await $.install(file, { install: false })) === installed;
        await writeFile(file, definition('bad', "'bad name':()=>({code:0})"));
        try {
          await installed.reload();
        } catch {
          /* working package remains */
        }
        const retained =
          installed.version === '1' &&
          (await (await $({ mirror: false })`package-installed`).text()) ===
            'one';
        await writeFile(
          file,
          definition('2', "'package-reloaded':()=>({code:0,stdout:'two'})")
        );
        await installed.reload();
        record('atomic package reload', [
          idempotent,
          retained,
          installed.version,
          !$.listCommands().includes('package-installed'),
        ]);
      } finally {
        installed.uninstall();
      }
      record(
        'registry discovery',
        await $.marketplace.search('git & deploy', {
          fetch: async (url) => {
            const request = new URL(url);
            if (
              request.searchParams.get('text') !==
              'keywords:command-stream-command git & deploy'
            ) {
              throw new Error('query changed');
            }
            return {
              ok: true,
              json: async () => ({
                objects: [
                  {
                    package: {
                      name: 'tools',
                      version: '1',
                      description: 'Git helpers',
                    },
                  },
                ],
              }),
            };
          },
        })
      );
    } finally {
      $.unregister('package-hello');
      $.unregister('package-greet');
      $.unregister('package-pipeline');
    }
  }
);
```

### Output

Identical in Node.js and Bun:

```
# command-packages — Compose and extend virtual commands
inherited middleware: "hello world!"
invalid names rejected: 6
streamed composition: [7,"ONE\nTWO\n","stop"]
atomic package reload: [true,true,"2",true]
registry discovery: [{"name":"tools","version":"1","description":"Git helpers"}]
```

## Rust

**API:** `CommandEnvironment`, `CommandPackage`

### Example

[`rust/examples/language_features.rs`](https://github.com/link-foundation/command-stream/blob/main/rust/examples/language_features.rs)

```rust
async fn command_packages() -> ExampleResult {
    let mut environment = CommandEnvironment::new();
    environment.create("package-hello", |context| async move {
        CommandResult::success(context.args.join(" "))
    })?;
    environment.inherit("package-greet", "package-hello", vec!["hello".into()])?;
    environment.extend("package-greet", |context, next| {
        Box::pin(async move {
            let result = next(context).await;
            CommandResult::success(format!("{}!", result.stdout))
        })
    })?;
    let inherited = observation(
        "inherited middleware",
        environment
            .run("package-greet", CommandContext::new(vec!["world".into()]))
            .await
            .stdout,
    );
    let mut rejected = 0;
    for name in [
        "",
        "two words",
        "7command",
        "command;echo",
        "écho",
        "line\n",
    ] {
        if environment
            .create(name, |_| async { CommandResult::success_empty() })
            .is_err()
        {
            rejected += 1;
        }
    }
    environment.create("package-generator", |context| async move {
        let tx = context.output_tx.unwrap();
        for chunk in ["one\n", "two\n"] {
            tx.send(command_stream::commands::StreamChunk::Stdout(chunk.into()))
                .await
                .unwrap();
        }
        CommandResult::success_empty()
    })?;
    environment.create("package-fail", |context| async move {
        CommandResult::new(context.stdin.unwrap().to_uppercase(), "stop", 7)
    })?;
    environment.create("package-unreachable", |_| async {
        panic!("continued after failure")
    })?;
    environment.compose(
        "package-pipeline",
        &["package-generator", "package-fail", "package-unreachable"],
    )?;
    let result = environment
        .run("package-pipeline", CommandContext::new(vec![]))
        .await;
    let directory = tempfile::tempdir()?;
    let file = directory.path().join("commands.json");
    let definition = |version: &str, commands: Value| {
        json!({"name":"parity-package","version":version,"commands":commands}).to_string()
    };
    tokio::fs::write(
        &file,
        definition(
            "1",
            json!({"package-installed":{"file":"echo","args":["one"]}}),
        ),
    )
    .await?;
    environment.install_file(&file).await?;
    let idempotent = environment.install_file(&file).await? == "parity-package";
    tokio::fs::write(
        &file,
        definition("bad", json!({"bad name":{"file":"echo"}})),
    )
    .await?;
    assert!(environment.reload_file(&file).await.is_err());
    let retained = environment.installed("parity-package").unwrap().version == "1"
        && environment.get("package-installed").is_some();
    tokio::fs::write(
        &file,
        definition("2", json!({"package-reloaded":{"file":"echo"}})),
    )
    .await?;
    environment.reload_file(&file).await?;
    let reload = json!([
        idempotent,
        retained,
        environment.installed("parity-package").unwrap().version,
        !environment.list().contains(&"package-installed".into())
    ]);
    environment.uninstall("parity-package");
    use command_stream::command_packages::{Marketplace, SearchOptions};
    let discovered = Marketplace::search_with("git & deploy", SearchOptions::default(), |url| async move {
        assert!(url.contains("text=keywords%3Acommand-stream-command%20git%20%26%20deploy"));
        Ok(json!({"objects":[{"package":{"name":"tools","version":"1","description":"Git helpers"}}]}))
    }).await?;
    Ok(vec![
        inherited,
        observation("invalid names rejected", rejected),
        observation(
            "streamed composition",
            json!([
                result.code,
                result.stdout.to_string(),
                result.stderr.to_string()
            ]),
        ),
        observation("atomic package reload", reload),
        observation("registry discovery", discovered),
    ])
}
```

### Output

```
# command-packages — Rust
inherited middleware: "hello world!"
invalid names rejected: 6
streamed composition: [7,"ONE\nTWO\n","stop"]
atomic package reload: [true,true,"2",true]
registry discovery: [{"description":"Git helpers","name":"tools","version":"1"}]
```

## The same thing in other libraries

### [Bun.$](https://bun.com/docs/runtime/shell)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [zx](https://github.com/google/zx)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [execa](https://github.com/sindresorhus/execa)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [ShellJS](https://github.com/shelljs/shelljs)

Not supported — No validated command package, inheritance, middleware, or registry search API.

### [node:child_process](https://nodejs.org/api/child_process.html)

Not supported — No validated command package, inheritance, middleware, or registry search API.

---

[← All features](../README.md)
