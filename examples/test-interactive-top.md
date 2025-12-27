# Testing Interactive Top Example

To test the interactive top example:

```bash
node examples/interactive-top.mjs
```

**Expected behavior:**

- The `top` command starts immediately
- ANSI colors and formatting are preserved
- Full interactivity is maintained (you can press keys like 'q' to quit)
- No time limits - runs until you manually quit
- Process cleanup happens properly when you exit

**Key features demonstrated:**

- ✅ ANSI colors preserved (addresses GitHub issue #10)
- ✅ Interactive I/O not interfered with (addresses GitHub issue #11)
- ✅ Manual control - no automatic timeouts
- ✅ Proper process management and cleanup

**Note:** Press 'q' to quit top when you're ready. The example will show the exit code when top terminates.
