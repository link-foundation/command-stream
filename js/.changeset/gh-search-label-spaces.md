---
'command-stream': patch
---

Fix shell quote removal so interpolated values containing spaces (e.g. GitHub search labels) reach commands as a single argument.

Previously `$\`gh issue list --label "${label}"\``(with`label = "help wanted"`) failed because command-stream only stripped quotes from wholly-quoted words. Mid-word quotes such as `label:"help wanted"`were left intact or split incorrectly, diverging from POSIX`sh`.

The parser now performs POSIX-style quote removal per argument (single quotes are literal; double quotes honor `\` escapes for ``$ ` " \``; backslash escapes outside quotes), so quoted and unquoted pieces concatenate into one argument — matching `/bin/sh`. Virtual commands (`echo`, custom handlers) receive the quote-removed value, while the original word is preserved for faithful re-serialization to a real shell. The Rust implementation is updated in parity.
