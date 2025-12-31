---
"command-stream": minor
---

Add `literal()` function to preserve apostrophes in shell arguments

When passing text containing apostrophes to programs that store it literally (like API calls via CLI tools), apostrophes would appear corrupted as triple quotes (`'''`). The new `literal()` function uses double-quote escaping which preserves apostrophes while still escaping shell-dangerous characters.

**New features:**
- `literal(value)` - Mark text for double-quote escaping, preserving apostrophes
- `quoteLiteral(value)` - Low-level function for manual command building

**Usage:**
```javascript
import { $, literal } from 'command-stream';

// Apostrophes now preserved for API storage
const notes = "Dependencies didn't exist";
await $`gh release create --notes ${literal(notes)}`;
```
