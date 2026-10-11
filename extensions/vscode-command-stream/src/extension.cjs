const docs = {
  echo: 'Print arguments, separated by spaces. Supports -n, -e, and -E.',
  cat: 'Concatenate files or read stdin. Use cat -- file to preserve leading dashes.',
  ls: 'List directory entries. Supports -a and -l.',
  pwd: 'Print the current working directory.',
  cd: 'Change the command-stream working directory.',
  mkdir: 'Create directories. Use -p to create parents.',
  rm: 'Remove files or directories. Supports -r and -f.',
  cp: 'Copy files or directories. Supports -r.',
  mv: 'Move or rename files.',
  touch: 'Create files or update modification times.',
  head: 'Print the first lines of input. Supports -n.',
  tail: 'Print the last lines of input. Supports -n.',
  sort: 'Sort input lines.',
  uniq: 'Remove adjacent duplicate lines.',
  grep: 'Select lines matching a pattern (external command).',
  git: 'Run Git with literal arguments using $.command.',
  true: 'Exit successfully.',
  false: 'Exit with status 1.',
  seq: 'Generate a sequence of numbers.',
  sleep: 'Pause for a duration in seconds.',
  tee: 'Copy stdin to files and stdout.',
};

function commands(document) {
  const result = { ...docs };
  for (const match of document
    .getText()
    .matchAll(/(?:\$\.create|register)\s*\(\s*['"]([^'"]+)['"]/g)) {
    result[match[1]] = 'Virtual command registered in this document.';
  }
  return result;
}

function shellPrefix(document, position) {
  const prefix = document
    .lineAt(position.line)
    .text.slice(0, position.character);
  return /(?:\$\s*`|[|;]\s*|\$\.command\(\s*['"])[\w:.-]*$/.test(prefix);
}

// Check literal shell quote balance, leaving JS interpolation to the JS/TS service.
function shellErrors(document) {
  const errors = [];
  for (const match of document.getText().matchAll(/\$\s*`((?:\\.|[^`])*)`/gs)) {
    const shell = match[1];
    if (shell.includes('${')) {
      continue;
    }
    let quote = null;
    for (let index = 0; index < shell.length; index++) {
      const char = shell[index];
      if (char === '\\' && quote !== "'") {
        index++;
        continue;
      }
      if ((char === "'" || char === '"') && (!quote || quote === char)) {
        quote = quote ? null : char;
      }
    }
    if (quote) {
      errors.push({
        offset: match.index,
        length: match[0].length,
        message: `Unclosed ${quote} shell quote`,
      });
    }
  }
  return errors;
}

function activate(context, vscode = require('vscode')) {
  const selectors = [
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
  ];
  const diagnostics =
    vscode.languages.createDiagnosticCollection('command-stream');
  const update = (document) => {
    if (!selectors.includes(document.languageId)) {
      return;
    }
    diagnostics.set(
      document.uri,
      shellErrors(document).map(
        (error) =>
          new vscode.Diagnostic(
            new vscode.Range(
              document.positionAt(error.offset),
              document.positionAt(error.offset + error.length)
            ),
            error.message,
            vscode.DiagnosticSeverity.Error
          )
      )
    );
  };
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCompletionItemProvider(
      selectors,
      {
        provideCompletionItems(document, position) {
          if (!shellPrefix(document, position)) {
            return [];
          }
          return Object.entries(commands(document)).map(
            ([name, documentation]) => {
              const item = new vscode.CompletionItem(
                name,
                vscode.CompletionItemKind.Function
              );
              item.documentation = documentation;
              item.detail = 'command-stream command';
              return item;
            }
          );
        },
      },
      '`',
      '|',
      "'",
      '"'
    ),
    vscode.languages.registerHoverProvider(selectors, {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[\w:.-]+/);
        if (!range) {
          return;
        }
        const description = commands(document)[document.getText(range)];
        if (description) {
          return new vscode.Hover(description, range);
        }
      },
    }),
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument((event) => update(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) =>
      diagnostics.delete(document.uri)
    ),
    vscode.commands.registerCommand('command-stream.repl', () => {
      const terminal = vscode.window.createTerminal('Command Stream REPL');
      terminal.show();
      terminal.sendText('npx command-stream repl');
    })
  );
  vscode.workspace.textDocuments.forEach(update);
}

module.exports = { activate, commands, shellErrors, shellPrefix };
