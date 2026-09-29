// One-off corpus edit (CI run 36548012648): expectations that real Bun.$
// does not meet on Windows. Bun prints the shell's cwd with native
// separators, joins directory entries natively, and has Windows-specific
// error messages. The JS port already printed the same, so the corpus was
// wrong, not the port.
// Rewrites the case files; run prettier on them afterwards.
import fs from 'node:fs';
import path from 'node:path';

const addNote = (c, note) => {
  c.note = c.note ? `${c.note.replace(/\.$/, '')}. ${note}` : note;
};
const dir = new URL('../../conformance/bun-shell/cases/', import.meta.url);
const CWD =
  'On Windows the shell cwd, as printed by `pwd` and `$PWD`, uses backslashes';
const native = (s) => s.replaceAll('{{TEMP}}', '{{TEMP_NATIVE}}');
const edits = {};

// The whole expected stdout (or file) is the shell cwd.
for (const id of [
  'bunshell/pwd-cd-subdir-and-back',
  'bunshell/subshell-does-not-change-cwd',
  'bunshell/subshell-pipeline-in-subshell',
  'bunshell/subshell-in-pipeline',
  'bunshell/subshell-in-pipeline-2',
  'bunshell/subshell-imbricated-pipelines',
  'lex/var-edgecase-echo',
  'lex/cmd-sub-edgecase-set',
  'lex/cmd-sub-combined-word-set',
  'lex/delimit-newline-after-variable',
  'lex/delimit-operator-after-variable-cat',
  'lex/delimit-operator-after-space',
  'lex/delimit-semicolon-after-variable-pwd',
  'lex/delimit-semicolon-after-closing-quote-echo',
  'lex/delimit-semicolon-after-brace-group-echo',
  'lex/delimit-end-of-input-after-variable',
  'parse/bad-syntax-cmd-subst-edgecase-set',
  'pipeline_stack/cd-pwd-cd-doesn-t-affect-next-command-in-pipeline',
  'pipeline_stack/cd-cd-pwd-multiple-cd-s-don-t-affect',
  'pipeline_stack/pwd-cd-pwd-cd-in-middle-doesn-t-affect',
]) {
  edits[id] = (c) => {
    c.expect.stdout = native(c.expect.stdout);
    addNote(c, CWD);
  };
}
edits['lex/var-edgecase-verbatim'] = (c) => {
  c.expect.stderr = native(c.expect.stderr);
  addNote(c, CWD);
};
for (const id of [
  'file-io/pwd-and-redirect',
  'file-io/pwd-and-append-redirect-new-file',
  'file-io/pwd-and-append-redirect-existing-file',
]) {
  edits[id] = (c) => {
    for (const [rel, v] of Object.entries(c.expect.files)) {
      c.expect.files[rel] = native(v);
    }
    addNote(c, CWD);
  };
}
edits['bunshell/subshell-sharp-script-shell-part'] = (c) => {
  c.expect.stdout = '{{TEMP_NATIVE}}{{SEP}}sharp-test\n';
  addNote(c, CWD);
};
edits['bunshell/cd-dash'] = (c) => {
  // `cd <path>` keeps the argument as given; `cd -` restores the native cwd.
  c.expect.stdout = '{{TEMP}}/d\n{{TEMP_NATIVE}}\n';
  addNote(c, `${CWD}; \`cd <dir>\` keeps the argument's slashes`);
};
edits['bunshell/cd-no-args-home'] = (c) => {
  c.expect.stdout = '{{TEMP_NATIVE}}\n{{TEMP}}/home\n';
  addNote(c, `${CWD}; \`cd\` keeps $HOME's slashes`);
};
edits['bunshell-file/bun-file-arg-prints-path'] = (c) => {
  c.expect.stdout = '{{TEMP_NATIVE}}{{SEP}}test.ts\n';
  addNote(c, 'A file reference interpolates as its native path');
};

// Glob and `ls -R` output join directory entries with the native separator.
const GLOB = 'Glob matches are joined with the native separator';
edits['brace/brace-then-glob-suffix'] = (c) => {
  c.expect.stdout = {
    oneOf: [
      'src/*.ts src/*.tsx src{{SEP}}app.ts src{{SEP}}util.tsx\n',
      'src/*.ts src/*.tsx src{{SEP}}util.tsx src{{SEP}}app.ts\n',
    ],
  };
  addNote(c, GLOB);
};
edits['brace/brace-prefix-then-glob'] = (c) => {
  c.expect.stdout = {
    oneOf: [
      'src/*.ts lib/*.ts src{{SEP}}a.ts lib{{SEP}}b.ts\n',
      'src/*.ts lib/*.ts lib{{SEP}}b.ts src{{SEP}}a.ts\n',
    ],
  };
  addNote(c, GLOB);
};
edits['bunshell/glob/literal-double-star'] = (c) => {
  c.expect.stdout.allOf[0] = { contains: 'sub{{SEP}}b.txt' };
  addNote(c, GLOB);
};
for (const id of [
  'commands-ls/recursive-basic',
  'commands-ls/flag-Ra',
  'commands-ls/flag-RA',
]) {
  edits[id] = (c) => {
    c.expect.stdout.sortedLines = c.expect.stdout.sortedLines.map((l) =>
      l.replace(/^\.\//, '.{{SEP}}')
    );
    addNote(c, '`ls -R` joins directory headers with the native separator');
  };
}

// `rm -v` prints a nested directory by its native path, and a file as its
// directory's path + "/" + name. The operands print as given.
const RM =
  '`rm -rv` prints nested directories by their native path and files as dir + "/" + name';
const rmTree = (root) => {
  const sub = `{{TEMP_NATIVE}}{{SEP}}${root.split('/').join('{{SEP}}')}`;
  return (lines) =>
    lines.map((l) =>
      l
        .replace(`{{TEMP}}/${root}/bar/b`, `${sub}{{SEP}}bar/b`)
        .replace(
          new RegExp(`^\\{\\{TEMP\\}\\}/${root}/bar$`),
          `${sub}{{SEP}}bar`
        )
    );
};
edits['commands-rm/recursive-verbose-dir'] = (c) => {
  c.expect.stdout.sortedLines = [
    '{{TEMP}}/folder',
    '{{TEMP_NATIVE}}{{SEP}}folder{{SEP}}sub',
    '{{TEMP_NATIVE}}{{SEP}}folder{{SEP}}sub/file.txt',
  ];
  addNote(c, RM);
};
edits['commands-rm/handoff-single'] = (c) => {
  c.expect.stdout.sortedLines = rmTree('t0/foo')(c.expect.stdout.sortedLines);
  addNote(c, RM);
};
edits['commands-rm/handoff-eight'] = (c) => {
  let lines = c.expect.stdout.sortedLines;
  for (let i = 0; i < 8; i++) {
    lines = rmTree(`t${i}/foo`)(lines);
  }
  c.expect.stdout.sortedLines = lines;
  addNote(c, RM);
};

// Windows-specific messages.
const blobError = (c) => {
  c.expect.error = {
    byPlatform: {
      windows: {
        contains:
          'Cannot redirect stdout/stderr to an immutable blob. Expected a file',
      },
      posix: { contains: c.expect.error },
    },
  };
  addNote(c, 'Bun words this error differently on Windows');
};
edits['bunshell-instance/stdout-redirect-to-blob-throws'] = blobError;
edits['bunshell-instance/stdout-redirect-to-response-throws'] = blobError;
edits['bunshell/exit-codes/mv-missing'] = (c) => {
  c.expect.stderr = {
    byPlatform: {
      windows: 'mv: No such file or directory\n',
      posix: c.expect.stderr,
    },
  };
  addNote(c, 'On Windows Bun leaves the path out of this message');
};
edits['file-io/write-to-invalid-path'] = (c) => {
  c.expect.stderr = {
    byPlatform: {
      windows: 'bun: No such file or directory: /dev/null/invalid/path',
      posix: c.expect.stderr,
    },
  };
  addNote(
    c,
    'Windows has no /dev/null directory entry, so the error is ENOENT'
  );
};
edits['parse/single-atom-tilde'] = (c) => {
  c.env.USERPROFILE = c.env.HOME;
  addNote(c, 'On Windows `~` expands to $USERPROFILE');
};

// libuv (used by Bun and Node.js) always passes these to a Windows child.
const WINDOWS_ENV = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];
for (const id of [
  'bunshell/change-env-child-process-env',
  'bunshell/change-env-child-process-env-again',
]) {
  edits[id] = (c) => {
    const str = '"(?:[^"\\\\]|\\\\.)*"';
    c.expect.stdout.allOf[0] = {
      byPlatform: {
        windows: {
          regex: `^\\{("(?:BUN_TEST_VAR|FOO|PWD|${WINDOWS_ENV.join('|')})":${str},?)+\\}\\n$`,
        },
        posix: c.expect.stdout.allOf[0],
      },
    };
    addNote(
      c,
      'On Windows libuv adds the system variables every process needs (HOMEDRIVE, SYSTEMROOT, ...)'
    );
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
