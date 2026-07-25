# Missing meta-language features found while building `$fy`

`$fy` translates shell scripts into command-stream modules using the model that
[link-foundation/meta-language](https://github.com/link-foundation/meta-language)
defines: a source text is _formalized_ into a links network, and the network is
then _substituted_ into a target language through a `TranslationRuleSet`.

The data model carried the whole design — `LinkNetwork`, `LinkType`,
`LinkQuery`, `TranslationRule`, `TranslationTemplate` are exactly the right
primitives, and `js/src/fy/shell-formalizer.mjs` and
`js/src/fy/translation-rules.mjs` use them directly. What is missing is the
_evaluation strategy_ that turns a rule set into output. That gap is filled
locally by `js/src/fy/rule-engine.mjs` (~215 lines), which is written so that it
collapses into a single upstream call once these features land.

Version under test: **meta-language 0.46.0** (the current npm `latest`). Note
that the repository's `main` is already at 0.54.0, so npm publishing lags the
repository — that alone is worth fixing, since consumers cannot try newer work.

Every gap below is reproduced by `js/experiments/meta-language-gaps.mjs`; run
`node js/experiments/meta-language-gaps.mjs` to see the observed output.

## 1. `TranslationRuleSet.render` does not substitute placeholders

The most important gap. `render()` returns the matched template's text
verbatim:

```js
ruleSet.render(network, linkId, 'JavaScript');
// template: 'await $`{body}`;'
// returns:  'await $`{body}`;'   <- `{body}` is never replaced
```

Without substitution a rule set can only emit constants, so it cannot express
any translation whose output depends on the source.

**Needed:** a placeholder syntax bound to the matched link's references, e.g.
`{name}` resolving through a rule-declared capture map.

## 2. No recursion into nested nodes

Related to 1: even given substitution, a template's placeholders must be filled
by _recursively rendering_ the captured child links. Translating `cd /tmp && ls`
requires rendering the `and` node's two operand nodes with their own rules.
Today only one rule fires, at one level.

**Needed:** bottom-up rendering, where a placeholder recursively applies the
rule set to the captured link.

## 3. Only the first matching rule is ever applied

`render()` picks the first rule whose `LinkQuery` matches and stops. A real
rule set has one rule per construct and needs all of them applied across the
network — rule _selection per link_, not per network.

**Needed:** per-link rule resolution (each link claimed by its best-matching
rule), which is what `RuleEngine`'s `rulesByLink` map does.

## 4. No reference-capture API on `TranslationRule`

A rule needs to name its children so templates can refer to them
(`{condition}`, `{body}`). `TranslationRule` exposes no such API, so `$fy`
attaches a plain `referenceCaptures` property and its own engine reads it:

```js
const created = new TranslationRule(term, syntax(term));
created.referenceCaptures = { condition: 0, body: 1 }; // no upstream equivalent
```

**Needed:** `rule.withCapture(name, index)` (or capture names on the query
itself, which would be nicer — it lets a query bind names structurally rather
than positionally).

## 5. No variadic placeholder for a node's children

A shell script, a `block`, a pipeline and a word list all have an unbounded
number of children joined by a separator (`"\n"`, `" | "`, `" "`). There is no
way to express "render every reference and join them".

**Needed:** something like `{*children|separator}`. `$fy` implements
`{*name:mode|sep}` with `\n`/`\t`/`\s` escapes in the separator.

## 6. No conditional/optional template segments

A command may or may not have an assignment prefix; an absent capture currently
has no defined behaviour and the placeholder text is emitted literally.

**Needed:** `{?name}…{/name}` segments, plus the rule that an unresolved
placeholder renders as empty rather than as its own source text.

## 7. No notion of a target _sub_-language / rendering context

The same shell node must render differently by context. `ls -la` is a statement
(``await $`ls -la`;``) at the top level but a fragment (`ls -la`) inside a
pipeline, and a variable is `NAME` as an expression but `${NAME}` inside a
template literal. `$fy` models this with four target languages —
`JavaScript`, `JavaScript:command`, `JavaScript:value`, `JavaScript:expression`
— plus a fallback chain, because meta-language has no first-class concept of a
rendering context.

**Needed:** either sub-languages with declared fallbacks, or per-placeholder
context selection, so context-dependence stays declarative instead of leaking
into imperative code.

## 8. No automatic indentation of multi-line substitutions

When a rendered child spans several lines and is substituted after leading
whitespace, its continuation lines must be indented to match, or every nested
block comes out ragged. `$fy` does this in `indentContinuation`.

**Needed:** indentation-aware substitution (the placeholder's column becomes
the continuation indent).

## 9. No builtin `Shell` language profile, and `parse()` produces no syntax nodes

`LanguageProfile.builtin()` resolves only `javascript`/`js`, and `parse()` on
Shell source tokenises per character without producing shell syntax nodes. This
is expected for a young project rather than a defect, but it means `$fy` has to
supply its own parser (`js/src/fy/shell-script-parser.mjs`) and formalizer.

**Needed (lower priority):** a `Shell` profile, or documentation stating that
front-ends are expected to be supplied by the consumer.

## Summary

Gaps 1–3 block rule-based translation entirely; 4–8 are what a usable rule
language needs in practice; 9 is scope. `js/src/fy/rule-engine.mjs` is a working
reference implementation of 1–8 over meta-language's own types and is offered
upstream.
