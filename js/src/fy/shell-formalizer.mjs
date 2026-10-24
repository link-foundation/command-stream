// Formalizes a shell script as a meta-language links network.
//
// This is the first half of the translation pipeline the way
// link-foundation/meta-language models it: source text becomes a network of
// typed links (`LinkType.Syntax` nodes over `LinkType.SourceToken` leaves).
// The second half — `translation-rules.mjs` plus `rule-engine.mjs` — rewrites
// that network into JavaScript purely by substitution rules.

import { LanguageProfile, LinkNetwork, LinkType } from 'meta-language';

import { parseShellScript } from './shell-script-parser.mjs';
import { expandWord } from './word-expander.mjs';

/** The language name used for every shell link in the network. */
export const SHELL_LANGUAGE = 'Shell';

/** Node terms that carry their own text (materialised as a leading token child). */
const TEXT_BEARING = new Set([
  'assignment',
  'export',
  'local',
  'comment',
  'name',
  'literal',
  'variable',
  'env-variable',
  'positional',
  'script-name',
  'all-arguments',
  'argument-count',
  'exit-status',
  'process-id',
  'unsupported-expansion',
  'default-expansion',
  'pattern',
  'redirect',
]);

/**
 * Collects the variable names the script binds, split by how they must be
 * declared in JavaScript.
 *
 * `export X=v` deliberately does not create a binding: it writes to
 * `process.env`, so `$X` must translate to `process.env.X`.
 *
 * @returns {{bound: Set<string>, locals: Set<string>}} `bound` is every name
 *   that becomes a JavaScript variable; `locals` is the subset already
 *   declared at its use site (`local`, and the `for` loop variable).
 */
function collectDeclaredNames(
  tree,
  names = { bound: new Set(), locals: new Set() }
) {
  if ((tree.term === 'assignment' || tree.term === 'local') && tree.text) {
    names.bound.add(tree.text);
    if (tree.term === 'local') {
      names.locals.add(tree.text);
    }
  }
  if (tree.term === 'for' && tree.children[0]?.text) {
    names.bound.add(tree.children[0].text);
    names.locals.add(tree.children[0].text);
  }
  for (const child of tree.children ?? []) {
    collectDeclaredNames(child, names);
  }
  return names;
}

/** Rewrites every `word` leaf into a `word` node of typed parts. */
function expandWords(tree, declared) {
  if (tree.term === 'word') {
    const parseSubstitution = (source) =>
      expandWords(parseShellScript(source), declared);
    return {
      term: 'word',
      text: undefined,
      children: expandWord(tree.text ?? '', declared, parseSubstitution),
    };
  }
  return {
    ...tree,
    children: (tree.children ?? []).map((child) =>
      expandWords(child, declared)
    ),
  };
}

/**
 * The capability profile of the shell dialect this translator formalizes.
 * Declaring it in the network makes the supported surface queryable rather
 * than implicit, and `validateNetwork` then rejects anything outside it.
 */
export function shellProfile(concepts) {
  let profile = LanguageProfile.new('command-stream shell', SHELL_LANGUAGE)
    .withLinkType(LinkType.Syntax)
    .withLinkType(LinkType.SourceToken)
    .withLinkType(LinkType.Semantic);
  for (const concept of concepts) {
    profile = profile.withConcept(concept);
  }
  return profile;
}

/**
 * Formalizes shell source as a links network.
 *
 * @param {string} source Shell source text.
 * @returns {{network: LinkNetwork, root: object, terms: Set<string>, names: object}}
 *   The network, the id of its `script` root link, every node term used, and
 *   the variable names the script binds.
 */
export function formalizeShell(source) {
  const parsed = parseShellScript(source);
  const names = collectDeclaredNames(parsed);
  const tree = expandWords(parsed, names.bound);

  const network = new LinkNetwork();
  const terms = new Set();

  const insert = (current) => {
    terms.add(current.term);
    const children = [];
    if (TEXT_BEARING.has(current.term) || current.text !== undefined) {
      children.push(
        network.insertSourceToken(SHELL_LANGUAGE, current.text ?? '')
      );
    }
    for (const child of current.children ?? []) {
      children.push(insert(child));
    }
    return network.insertSyntaxNode(SHELL_LANGUAGE, current.term, children);
  };

  const root = insert(tree);
  return { network, root, terms, names };
}
