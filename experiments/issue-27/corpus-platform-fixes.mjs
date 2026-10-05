// One-off corpus edit (CI run 36546570703): expectations that assumed Linux
// directory order, GNU cp wording or a Linux-only child environment.
// Rewrites the case files; run prettier on them afterwards.
import fs from 'node:fs';
import path from 'node:path';

const addNote = (c, note) => {
  c.note = c.note ? `${c.note.replace(/\.$/, '')}. ${note}` : note;
};
const dir = new URL('../../conformance/bun-shell/cases/', import.meta.url);
const ORDER =
  '`ls` lists entries in directory order, which differs between file systems.';
const edits = {
  'parse/cmd-subst-edgecase-dir': (c) => {
    c.expect.stdout = { oneOf: ['x y\nnice\n', 'y x\nnice\n'] };
    addNote(c, ORDER);
  },
  'lex/cmd-sub-dollar': (c) => {
    c.expect.stdout = { oneOf: ['foo a.txt b.txt\n', 'foo b.txt a.txt\n'] };
    addNote(c, ORDER);
  },
  'commands-cp/file-to-missing-dir-fails-posix': (c) => {
    c.expect.stderr = { contains: 'lmao2' };
    addNote(
      c,
      'GNU cp says "cannot create regular file \'lmao2/\'", BSD cp (macOS) "lmao2: No such file or directory"'
    );
  },
  'bunshell/posix-command-ending-with-asynchronous-command-after-else': (c) => {
    const notFound = 'bun: command not found: !\nbun: command not found: !\n';
    c.expect.stderr = {
      oneOf: [`${notFound}bun: command not found: wait\n`, notFound],
    };
    c.expect.exitCode = { oneOf: [1, 0] };
    addNote(c, 'macOS ships /usr/bin/wait, so there `wait` runs and exits 0');
  },
};
const envRegex =
  '^\\{("[A-Z_]+":"[^"]*",?){3}("__CF_USER_TEXT_ENCODING":"[^"]*")?\\}\\n$';
for (const id of [
  'bunshell/change-env-child-process-env',
  'bunshell/change-env-child-process-env-again',
]) {
  edits[id] = (c) => {
    c.expect.stdout.allOf[0] = { regex: envRegex };
    addNote(c, 'macOS adds __CF_USER_TEXT_ENCODING to every child environment');
  };
}

const done = new Set();
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir.pathname, name);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  for (const unit of json.units) {
    for (const c of unit.cases ?? []) {
      if (edits[c.id]) {
        edits[c.id](c, unit);
        done.add(c.id);
        changed = true;
      }
    }
  }
  if (changed) {
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
}
const missing = Object.keys(edits).filter((id) => !done.has(id));
if (missing.length) {
  throw new Error(`cases not found: ${missing}`);
}
console.log(`edited ${done.size} cases`);
