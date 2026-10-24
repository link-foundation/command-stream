// Source front ends produce typed links; the rule engine alone renders them.
import { parse } from 'acorn';
import {
  LinkNetwork,
  LinkQuery,
  LinkType,
  TranslationRule,
  TranslationRuleSet,
} from 'meta-language';
import { formalizeShell } from './shell-formalizer.mjs';
import { RuleEngine } from './rule-engine.mjs';

export const MIGRATION_TARGETS = {
  zx: 'zx',
  'zx/core': 'zx/core',
  'zx/globals': 'zx/globals',
  'zx/cli': 'zx/cli',
  execa: 'execa',
  shelljs: 'shelljs',
  'shelljs/plugin': 'shelljs/plugin',
  'cross-spawn': 'cross-spawn',
  bun: 'bun',
};
const SOURCES = new Set([
  'auto',
  'javascript',
  'js',
  'zx',
  'execa',
  'shelljs',
  'cross-spawn',
  'bun',
]);
const SHELLS = new Set(['shell', 'sh', 'bash', 'dash', 'zsh']);
const TARGET = 'JavaScript';

function rule(language, term, text, captures = {}) {
  const result = new TranslationRule(
    term,
    new LinkQuery({ linkType: LinkType.Syntax, language }).withTerm(term)
  );
  result.referenceCaptures = captures;
  result.withTemplate(TARGET, text);
  return result;
}

function render(network, root, rules) {
  const ruleSet = new TranslationRuleSet('source-to-command-stream', rules);
  const engine = new RuleEngine(network, ruleSet, {
    modes: { json: { transform: JSON.stringify } },
  });
  const code = engine.render(root);
  return { code, diagnostics: engine.report(), network, ruleSet };
}

function shellFromShebang(source) {
  const [line] = source.split('\n', 1);
  if (!line.startsWith('#!')) {
    return undefined;
  }
  const words = line
    .slice(2)
    .trim()
    .split(/[ \t]+/);
  const interpreter =
    words.length === 2 && words[0] === '/usr/bin/env'
      ? words[1]
      : words.length === 1
        ? words[0]
        : undefined;
  const shell = interpreter?.split('/').at(-1);
  return ['sh', 'bash', 'dash', 'zsh'].includes(shell) ? shell : undefined;
}

/** Preserve the interpreter's full semantics while formalizing and substituting a program rule. */
export function translateShellProgram(source, options = {}) {
  const { network, root: syntax } = formalizeShell(source);
  const shell = options.shell ?? shellFromShebang(source) ?? 'sh';
  const values = [
    source,
    shell,
    options.name ?? 'translated.sh',
    options.moduleName ?? 'command-stream',
  ];
  const refs = values.map((value) => network.insertSourceToken('Shell', value));
  const root = network.insertSyntaxNode('Shell', 'shell-program', [
    ...refs,
    syntax,
  ]);
  const header = options.shebang === false ? '' : '#!/usr/bin/env node\n';
  const load =
    options.useM === false
      ? 'import {{ command }} from {module:json};\n'
      : "import {{ use }} from 'use-m';\nconst {{ command }} = await use({module:json});\n";
  const template = `${
    header + load
  }const source = {source:json};\nconst result = await command({shell:json}, '-c', source, {name:json}, ...process.argv.slice(2))\n  .with({{ mirror: true, capture: false, stdin: 'inherit' }}).run();\nprocess.exitCode = result.code;\n`;
  return render(network, root, [
    rule('Shell', 'shell-program', template, {
      source: 0,
      shell: 1,
      name: 2,
      module: 3,
    }),
  ]);
}

const bindsRequire = (pattern) =>
  pattern &&
  (pattern.type === 'Identifier'
    ? pattern.name === 'require'
    : Object.values(pattern).some((value) =>
        Array.isArray(value)
          ? value.some(bindsRequire)
          : value && typeof value === 'object' && bindsRequire(value)
      ));

function declaresRequire(node) {
  if (['VariableDeclarator', 'ClassDeclaration'].includes(node.type)) {
    return bindsRequire(node.id);
  }
  if (/Function/.test(node.type)) {
    return bindsRequire(node.id) || node.params.some(bindsRequire);
  }
  if (node.type === 'CatchClause') {
    return bindsRequire(node.param);
  }
  return node.type.startsWith('Import') && bindsRequire(node.local);
}
function isRequireCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    typeof node.arguments[0]?.value === 'string'
  );
}

/** Find module sources from the JavaScript AST, never by rewriting arbitrary strings. */
function moduleReferences(source, commonjs, diagnostics) {
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: commonjs,
  });
  const references = [];
  const requires = [];
  let boundRequire = false;
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node.type !== 'string') {
      continue;
    }
    boundRequire ||= declaresRequire(node);
    if (
      node.source &&
      typeof node.source.value === 'string' &&
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
      ].includes(node.type)
    ) {
      references.push(node.source);
    }
    if (isRequireCall(node)) {
      requires.push(node.arguments[0]);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (value && typeof value === 'object') {
        pending.push(value);
      }
    }
  }
  if (boundRequire && requires.length) {
    diagnostics.push(
      'locally bound require: require calls retained; import declarations still migrate'
    );
  } else {
    references.push(...requires);
  }
  return references.sort((a, b) => a.start - b.start);
}

/** Translate competitor source through command-stream's matching compatibility APIs. */
export function translateCompetitorSource(source, options = {}) {
  const network = new LinkNetwork();
  const rules = [rule('JavaScript', 'source-program', '{*.:raw}')];
  // Raw substitutions preserve original layout even after whitespace-only lines.
  const replacements = [];
  const diagnostics = [];
  for (const reference of moduleReferences(
    source,
    options.commonjs ?? false,
    diagnostics
  )) {
    const suffix = Object.hasOwn(MIGRATION_TARGETS, reference.value)
      ? MIGRATION_TARGETS[reference.value]
      : undefined;
    if (!suffix) {
      if (/^(zx|execa|shelljs|cross-spawn)\//.test(reference.value)) {
        diagnostics.push(
          `unsupported competitor entry point: ${reference.value}`
        );
      }
      continue;
    }
    const term = `module-${reference.value}`;
    const target = `${options.moduleName ?? 'command-stream'}/${suffix}`;
    replacements.push({ start: reference.start, end: reference.end, term });
    rules.push(
      rule('JavaScript', term, JSON.stringify(target).replace(/[{}]/g, '$&$&'))
    );
  }
  const children = [];
  let end = 0;
  for (const replacement of replacements) {
    children.push(
      network.insertSourceToken(
        'JavaScript',
        source.slice(end, replacement.start)
      )
    );
    children.push(
      network.insertSyntaxNode('JavaScript', replacement.term, [
        network.insertSourceToken(
          'JavaScript',
          source.slice(replacement.start, replacement.end)
        ),
      ])
    );
    end = replacement.end;
  }
  children.push(network.insertSourceToken('JavaScript', source.slice(end)));
  const root = network.insertSyntaxNode(
    'JavaScript',
    'source-program',
    children
  );
  const ruleSet = new TranslationRuleSet(
    'competitors-to-command-stream',
    rules
  );
  // A language mode renders child rules, while bypassing indentation for source spans.
  const engine = new RuleEngine(network, ruleSet, {
    modes: { raw: { language: TARGET } },
    preserveLayout: true,
  });
  let code = engine.render(root);
  if (options.commonjs) {
    code = commonjsModule(code);
  }
  if (options.shebang === false) {
    code = code.replace(/^#![^\n]*\n?/, '');
  }
  return {
    code,
    diagnostics: [...diagnostics, ...engine.report()],
    network,
    ruleSet,
  };
}

function commonjsModule(source) {
  const body = source.replace(/^#![^\n]*\n?/, '');
  return `#!/usr/bin/env node\nimport { createRequire as __fyRequire } from 'node:module';\nimport { fileURLToPath as __fyPath } from 'node:url';\nimport { dirname as __fyDir } from 'node:path';\nconst __fyModule = { exports: {} };\n(function (require, module, exports, __filename, __dirname) {\n${
    body
  }\n})(__fyRequire(import.meta.url), __fyModule, __fyModule.exports, __fyPath(import.meta.url), __fyDir(__fyPath(import.meta.url)));\nexport default __fyModule.exports;\n`;
}

/** Auto chooses a shell for shell source and JavaScript for .mjs/.js/.cjs filenames. */
export function translateSource(source, options = {}) {
  if (typeof source !== 'string' || source.includes('\0')) {
    throw new TypeError('Source must be a string without NUL');
  }
  let from = options.from ?? 'auto';
  if (from === 'auto') {
    from = /\.[cm]?js$/i.test(options.filename ?? '') ? 'javascript' : 'shell';
  }
  if (SHELLS.has(from)) {
    return translateShellProgram(source, {
      ...options,
      shell: options.shell ?? (from === 'shell' ? undefined : from),
    });
  }
  if (!SOURCES.has(from)) {
    throw new Error(`Unsupported source language: ${from}`);
  }
  return translateCompetitorSource(source, {
    ...options,
    commonjs: options.commonjs ?? /\.cjs$/i.test(options.filename ?? ''),
  });
}
