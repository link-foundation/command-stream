---
'command-stream': patch
---

Route redirections and expansions to the system shell so they are no longer
silently swallowed by built-in commands (#46).

`needsRealShell()` was only consulted when the command also contained `&&`,
`||`, `;`, `&` or `(`, and redirection characters are not part of that operator
set. A command whose first word is a built-in (`echo`, `cat`, `true`, `ls`,
`seq`, ...) was therefore dispatched in-process with the operators passed
through as literal arguments: `echo hello > out.txt` printed `hello > out.txt`
and wrote no file, and `git push origin main 2>&1` reported exit code 0 with
empty output even when the push had failed. The verdict is now independent of
the operator set, and `>`, `>>`, `<`, `2>`, `&>`, `>&` and `<<` are recognised
as requiring a real shell, matching `/bin/sh` behaviour. Redirection characters
inside quotes stay literal, as in `sh`.
