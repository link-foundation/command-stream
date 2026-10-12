"""Split Rust files over the 1000-line limit (rust/scripts/check-file-size.rs)
into submodules, moving whole sections so the code itself is unchanged.
Visibility fixes are done by hand afterwards."""
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]


def lines(p):
    return (root / p).read_text().split('\n')


def write(p, text):
    (root / p).parent.mkdir(parents=True, exist_ok=True)
    (root / p).write_text(text)


def dedent_test_module(body):
    """`mod tests { ... }` body lines -> file contents."""
    out = []
    for line in body:
        out.append(line[4:] if line.startswith('    ') else line)
    return '\n'.join(out).rstrip() + '\n'


def extract_tests(path, decl):
    src = lines(path)
    start = next(i for i, l in enumerate(src) if l == '#[cfg(test)]' and src[i + 1].endswith('mod tests {'))
    end = max(i for i, l in enumerate(src) if l == '}')
    body = src[start + 2:end]
    write(path.replace('.rs', '/tests.rs'), dedent_test_module(body))
    rest = src[:start] + ['#[cfg(test)]', decl] + src[end + 1:]
    write(path, '\n'.join(rest))


def banner_sections(src):
    """Indices of `// ----` banner starts (3-line banners)."""
    return [i for i, l in enumerate(src) if l.startswith('// ----') and i + 2 < len(src) and src[i + 2].startswith('// ----')]


# lexer.rs / parser.rs: tests into lexer/tests.rs and parser/tests.rs.
extract_tests('rust/src/bun_shell/lexer.rs', 'mod tests;')
extract_tests('rust/src/bun_shell/parser.rs', 'pub(crate) mod tests;')

# parser.rs: the AST (everything from RedirectFlags to the parser consts) into parser/ast.rs.
src = lines('rust/src/bun_shell/parser.rs')
a = next(i for i, l in enumerate(src) if l.startswith('/// Redirection flags'))
b = next(i for i, l in enumerate(src) if l.startswith('const SINGLE_ARG_OPS'))
ast = ['//! The Bun Shell AST (Bun\'s `src/shell_parser/parse.rs` `ast`).', '',
       'use std::fmt;', 'use std::ops::BitOr;', ''] + src[a:b]
write('rust/src/bun_shell/parser/ast.rs', '\n'.join(ast).rstrip() + '\n')
head = [l for l in src[:a] if l not in ('use std::fmt;', 'use std::ops::BitOr;')]
write('rust/src/bun_shell/parser.rs', '\n'.join(head + ['mod ast;', 'pub(crate) use ast::*;', ''] + src[b:]))

# glob.rs: errors, path helpers, walker and tests into glob/*.rs.
extract_tests('rust/src/bun_shell/glob.rs', 'mod tests;')
src = lines('rust/src/bun_shell/glob.rs')
banners = banner_sections(src)
title = {src[i + 1][3:]: i for i in banners}
uses = [l for l in src if l.startswith('use ')]
cut = {
    'error': title['Errors'],
    'path': title['Path helpers'],
    'walker': title['Walker (GlobWalker.rs)'],
}
tests_at = next(i for i, l in enumerate(src) if l == '#[cfg(test)]')
bounds = [cut['error'], cut['path'], cut['walker'], tests_at]
docs = {
    'error': '//! Glob errors, shaped like Node.js system errors.',
    'path': '//! Path helpers of the glob walker (Node.js `path.posix` semantics).',
    'walker': '//! The directory walker (Bun\'s `src/glob/GlobWalker.rs`).',
}
for (name, s), e in zip(cut.items(), bounds[1:]):
    body = src[s + 3:e]
    text = '\n'.join([docs[name], '', 'use super::*;'] + [''] + body).rstrip() + '\n'
    write(f'rust/src/bun_shell/glob/{name}.rs', text)
main = src[:cut['error']] + ['mod error;', 'mod path;', 'mod walker;', '',
                              'pub(crate) use error::*;', 'use path::*;', 'pub(crate) use walker::*;', ''] + src[tests_at:]
write('rust/src/bun_shell/glob.rs', '\n'.join(main))

# corpus.rs: the Expectations section into expect.rs.
p = 'rust/tests/bun_shell_conformance/corpus.rs'
src = lines(p)
banners = banner_sections(src)
title = {src[i + 1][3:]: i for i in banners}
s, e = title['Expectations'], title['Applicability']
expect = ['//! EXPECT matching (`matchText`, `matchExit`, `checkExpectations` in',
          '//! `corpus.mjs`).', '', 'use super::*;', ''] + src[s + 3:e]
write('rust/tests/bun_shell_conformance/expect.rs', '\n'.join(expect).rstrip() + '\n')
write(p, '\n'.join(src[:s] + ['#[path = "expect.rs"]', 'mod expect;', 'pub use expect::*;', ''] + src[e:]))
print('split done')
