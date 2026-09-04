# Best Practices for command-stream (Rust)

This document covers best practices, common patterns, and pitfalls to avoid when using the command-stream Rust library.

## Table of Contents

- [Argument Handling with Macros](#argument-handling-with-macros)
- [String Interpolation](#string-interpolation)
- [Security Best Practices](#security-best-practices)
- [Error Handling](#error-handling)
- [Async Patterns](#async-patterns)
- [Common Pitfalls](#common-pitfalls)

---

## Argument Handling with Macros

### Using the cmd!/s!/sh! Macros

The command-stream macros (`cmd!`, `s!`, `sh!`, `cs!`) provide safe interpolation similar to JavaScript's `$` template literal:

```rust
use command_stream::s;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Simple command
    let result = s!("echo hello world").await?;

    // With interpolation (automatically quoted)
    let name = "world";
    let result = s!("echo hello {}", name).await?;

    // Multiple arguments
    let file = "test.txt";
    let flag = "--verbose";
    let result = s!("cat {} {}", file, flag).await?;

    Ok(())
}
```

### Handling Multiple Arguments

When you have a collection of arguments, handle them correctly:

```rust
use command_stream::{run, quote};

// CORRECT: Use quote::quote_all for multiple arguments
let args = vec!["file.txt", "--public", "--verbose"];
let quoted_args = quote::quote_all(&args);
let result = run(format!("command {}", quoted_args)).await?;

// CORRECT: Build command with individual quotes
let args = vec!["file.txt", "--public", "--verbose"];
let cmd = format!("command {}",
    args.iter()
        .map(|a| quote::quote(a))
        .collect::<Vec<_>>()
        .join(" ")
);
let result = run(cmd).await?;
```

### Vec/Slice Handling Patterns

Unlike JavaScript where arrays are handled automatically in template literals, Rust requires explicit handling:

```rust
use command_stream::quote;

// Pattern 1: quote_all function
let args = vec!["file.txt", "--verbose"];
let args_str = quote::quote_all(&args);
// Result: "file.txt --verbose" (each arg properly quoted)

// Pattern 2: Manual iteration
let args = vec!["file with spaces.txt", "--verbose"];
let args_str = args.iter()
    .map(|a| quote::quote(a))
    .collect::<Vec<_>>()
    .join(" ");
// Result: "'file with spaces.txt' --verbose"

// Pattern 3: Format with multiple placeholders
let file = "data.txt";
let flag1 = "--verbose";
let flag2 = "--force";
let result = s!("cmd {} {} {}", file, flag1, flag2).await?;
```

---

## String Interpolation

### Safe Interpolation (Default)

The `quote` function automatically escapes dangerous characters:

```rust
use command_stream::quote::quote;

let dangerous = "'; rm -rf /; echo '";
let safe = quote(dangerous);
// Result: "''\\'' rm -rf /; echo '\\'''"
// Shell will treat this as a literal string
```

### When Quoting is Applied

```rust
use command_stream::quote::{quote, needs_quoting};

// Safe strings pass through unchanged
assert_eq!(quote("hello"), "hello");
assert_eq!(quote("/path/to/file"), "/path/to/file");

// Dangerous strings are quoted
assert_eq!(quote("hello world"), "'hello world'");
assert_eq!(quote("$var"), "'$var'");

// Check if quoting is needed
assert!(!needs_quoting("hello"));
assert!(needs_quoting("hello world"));
```

---

## Security Best Practices

### Never Trust User Input

```rust
use command_stream::{run, quote};

async fn process_file(user_filename: &str) -> Result<(), Box<dyn std::error::Error>> {
    // CORRECT: Quote user input
    let safe_filename = quote::quote(user_filename);
    let result = run(format!("cat {}", safe_filename)).await?;

    // ALSO CORRECT: Use macro interpolation
    let result = s!("cat {}", user_filename).await?;

    Ok(())
}
```

### Validate Before Execution

```rust
use command_stream::run;
use std::path::Path;

async fn delete_file(filename: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Validate: no path traversal
    if filename.contains("..") || filename.starts_with('/') {
        return Err("Invalid filename".into());
    }

    // Validate: file exists and is a file (not directory)
    let path = Path::new(filename);
    if !path.is_file() {
        return Err("Not a file".into());
    }

    run(format!("rm {}", quote::quote(filename))).await?;
    Ok(())
}
```

---

## Error Handling

### Check Results

```rust
use command_stream::run;

async fn example() -> Result<(), Box<dyn std::error::Error>> {
    let result = run("ls nonexistent").await?;

    match result.code {
        0 => println!("Success: {}", result.stdout),
        2 => eprintln!("File not found"),
        127 => eprintln!("Command not found"),
        code => eprintln!("Unknown error (code {})", code),
    }

    Ok(())
}
```

### Using the ? Operator

```rust
use command_stream::{run, Result};

async fn critical_operation() -> Result<String> {
    let result = run("important-command").await?;

    if result.code != 0 {
        return Err(command_stream::Error::CommandFailed {
            code: result.code,
            message: result.stderr,
        });
    }

    Ok(result.stdout)
}
```

---

## Async Patterns

### Basic Async Usage

```rust
use command_stream::run;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let result = run("echo hello").await?;
    println!("{}", result.stdout);
    Ok(())
}
```

### Parallel Execution

```rust
use command_stream::run;
use tokio;

async fn parallel_tasks() -> Result<(), Box<dyn std::error::Error>> {
    // Run multiple commands in parallel
    let (r1, r2, r3) = tokio::join!(
        run("task1"),
        run("task2"),
        run("task3")
    );

    println!("Task 1: {}", r1?.stdout);
    println!("Task 2: {}", r2?.stdout);
    println!("Task 3: {}", r3?.stdout);

    Ok(())
}
```

### Using ProcessRunner for Control

```rust
use command_stream::{ProcessRunner, RunOptions};

async fn controlled_execution() -> Result<(), Box<dyn std::error::Error>> {
    let options = RunOptions {
        capture: true,
        mirror: false,  // Don't print to terminal
        ..Default::default()
    };

    let mut runner = ProcessRunner::new("long-command", options);
    runner.start().await?;
    let result = runner.run().await?;

    println!("Captured: {}", result.stdout);
    Ok(())
}
```

---

## Common Pitfalls

### 1. String Formatting Without Quoting

**Problem:** Using `format!` without quoting can cause issues with special characters.

```rust
// WRONG: Spaces break the command
let filename = "my file.txt";
let cmd = format!("cat {}", filename);
// Result: "cat my file.txt" - interpreted as two args!

// CORRECT: Quote the value
let cmd = format!("cat {}", quote::quote(filename));
// Result: "cat 'my file.txt'" - single argument
```

### 2. Vec Join Without Proper Quoting

**Problem:** Joining a Vec without quoting each element.

```rust
// WRONG: join doesn't quote elements
let args = vec!["file with spaces.txt", "--flag"];
let cmd = format!("command {}", args.join(" "));
// Result: "command file with spaces.txt --flag" - BROKEN!

// CORRECT: Use quote_all
let cmd = format!("command {}", quote::quote_all(&args));
// Result: "command 'file with spaces.txt' --flag"
```

### 3. Forgetting .await

**Problem:** Async functions return futures that must be awaited.

```rust
// WRONG: Command never executes
let result = run("echo hello");  // Returns Future, not Result!

// CORRECT: Await the future
let result = run("echo hello").await?;
```

### 4. Not Handling Non-Zero Exit Codes

**Problem:** Assuming success without checking.

```rust
// RISKY: May fail silently
let result = run("risky-command").await?;
use_output(&result.stdout);

// BETTER: Check exit code
let result = run("risky-command").await?;
if result.code == 0 {
    use_output(&result.stdout);
} else {
    handle_error(&result.stderr);
}
```

### 5. Blocking in Async Context

**Problem:** Using `run_sync` in async context blocks the runtime.

```rust
// WRONG in async context
async fn bad_example() {
    // This blocks the entire runtime thread!
    let result = run_sync("slow-command");
}

// CORRECT: Use async version
async fn good_example() {
    let result = run("slow-command").await;
}
```

---

## Quick Reference

### Do's

- Use `quote::quote()` for individual values
- Use `quote::quote_all()` for Vec/slice of arguments
- Use macro interpolation (`s!`, `cmd!`) for safe templating
- Always `.await` async operations
- Check exit codes for critical operations
- Validate user input before execution

### Don'ts

- Never format user input without quoting
- Never use `args.join(" ")` without quoting each element
- Don't forget `.await` on futures
- Don't assume commands succeed
- Don't block async contexts with `run_sync`

---

## See Also

- [../js/BEST-PRACTICES.md](../js/BEST-PRACTICES.md) - JavaScript best practices
- [src/quote.rs](src/quote.rs) - Quote function implementation
- [src/macros.rs](src/macros.rs) - Macro implementations
