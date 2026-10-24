// Probes meta-language for the capabilities a rule-based sh -> mjs translator
// needs. Prints PASS/GAP per capability with the observed behaviour.
//
// Usage:
//   node experiments/meta-language-gaps.mjs               # probe the installed npm package
//   node experiments/meta-language-gaps.mjs /path/to/meta-language/js/src/index.js
//
// The second form lets us compare the published npm package against the
// meta-language repository's `main`, which is several unpublished releases
// ahead of npm.

const entry = process.argv[2] ?? 'meta-language';
const {
  LanguageProfile,
  LinkNetwork,
  LinkQuery,
  LinkType,
  TranslationRule,
  TranslationRuleSet,
} = await import(entry);

const report = [];
const probe = (name, fn) => {
  try {
    report.push([name, ...fn()]);
  } catch (error) {
    report.push([name, 'GAP', `threw: ${error.message}`]);
  }
};

const syntaxQuery = (term) =>
  new LinkQuery({ linkType: LinkType.Syntax }).withTerm(term);

// Builds a two-level shell network: `cd /tmp && ls -la`.
function buildAndNetwork() {
  const network = new LinkNetwork();
  const command = (text) =>
    network.insertSyntaxNode('Shell', 'command', [
      network.insertSourceToken('Shell', text),
    ]);
  network.insertSyntaxNode('Shell', 'and', [
    command('cd /tmp'),
    command('ls -la'),
  ]);
  return network;
}

function commandRule() {
  const rule = new TranslationRule('command', syntaxQuery('command'));
  rule.withReferenceCapture?.('body', 0);
  return rule.withTemplate('JavaScript', 'await $`{body}`;');
}

function andRule() {
  const rule = new TranslationRule('and', syntaxQuery('and'));
  rule.withReferenceCapture?.('left', 0);
  rule.withReferenceCapture?.('right', 1);
  return rule.withTemplate('JavaScript', '{left}\n{right}');
}

probe('builtin shell/bash language profile', () => {
  const found = ['bash', 'sh', 'shell'].filter((name) =>
    LanguageProfile.builtin(name)
  );
  return found.length > 0
    ? ['PASS', `builtin profiles: ${found.join(', ')}`]
    : ['GAP', 'LanguageProfile.builtin() resolves only javascript/js'];
});

probe('shell-aware parsing (syntax nodes from source text)', () => {
  const network = LinkNetwork.parse('cd /tmp && ls -la\n', 'Shell');
  const syntax = network
    .links()
    .filter((link) => link.metadata().linkType === LinkType.Syntax);
  return syntax.length > 0
    ? ['PASS', `${syntax.length} syntax nodes`]
    : [
        'GAP',
        'parse() tokenises Shell per character only; no shell syntax nodes are produced',
      ];
});

probe('template placeholder substitution', () => {
  const network = buildAndNetwork();
  const output = new TranslationRuleSet('shell-to-js', [commandRule()]).render(
    'JavaScript',
    network
  );
  return output.includes('cd /tmp')
    ? ['PASS', output]
    : ['GAP', `template text is emitted verbatim: ${JSON.stringify(output)}`];
});

probe('recursive rendering of nested nodes', () => {
  const network = buildAndNetwork();
  const output = new TranslationRuleSet('shell-to-js', [
    andRule(),
    commandRule(),
  ]).render('JavaScript', network);
  const expected = 'await $`cd /tmp`;\nawait $`ls -la`;';
  return output === expected
    ? ['PASS', output]
    : [
        'GAP',
        `rendered ${JSON.stringify(output)}, expected ${JSON.stringify(expected)}`,
      ];
});

probe('composing several rules over one network', () => {
  // Two sibling top-level nodes that need two different rules.
  const network = new LinkNetwork();
  network.insertSyntaxNode('Shell', 'comment', [
    network.insertSourceToken('Shell', 'build step'),
  ]);
  network.insertSyntaxNode('Shell', 'command', [
    network.insertSourceToken('Shell', 'make all'),
  ]);

  const comment = new TranslationRule('comment', syntaxQuery('comment'));
  comment.withReferenceCapture?.('body', 0);
  comment.withTemplate('JavaScript', '// {body}');

  const output = new TranslationRuleSet('shell-to-js', [
    comment,
    commandRule(),
  ]).render('JavaScript', network);
  const expected = '// build step\nawait $`make all`;';
  return output === expected
    ? ['PASS', output]
    : [
        'GAP',
        `only the first matching rule is applied; got ${JSON.stringify(output)}`,
      ];
});

probe('variadic / repeated reference capture', () => {
  const network = new LinkNetwork();
  const stages = ['ls', 'grep test', 'wc -l'].map((text) =>
    network.insertSyntaxNode('Shell', 'command', [
      network.insertSourceToken('Shell', text),
    ])
  );
  network.insertSyntaxNode('Shell', 'pipeline', stages);
  const rule = new TranslationRule(
    'pipeline',
    syntaxQuery('pipeline')
  ).withTemplate('JavaScript', 'await $`{stages:join= | }`;');
  const output = new TranslationRuleSet('p', [rule]).render(
    'JavaScript',
    network
  );
  return output.includes('ls | grep test | wc -l')
    ? ['PASS', output]
    : ['GAP', `no repeated-capture placeholder; got ${JSON.stringify(output)}`];
});

probe('optional / conditional template segment', () => {
  const network = new LinkNetwork();
  network.insertSyntaxNode('Shell', 'command', [
    network.insertSourceToken('Shell', 'ls'),
  ]);
  const rule = new TranslationRule('command', syntaxQuery('command'));
  rule.withReferenceCapture?.('body', 0);
  rule.withTemplate('JavaScript', 'await $`{body}`;{?args: {args}}');
  const output = new TranslationRuleSet('c', [rule]).render(
    'JavaScript',
    network
  );
  return output === 'await $`ls`;'
    ? ['PASS', output]
    : [
        'GAP',
        `an absent capture is emitted literally: ${JSON.stringify(output)}`,
      ];
});

console.log(`meta-language entry: ${entry}\n`);
for (const [name, status, detail] of report) {
  console.log(
    `${status.padEnd(4)} | ${name}\n       ${String(detail).replace(/\n/g, '\n       ')}`
  );
}
