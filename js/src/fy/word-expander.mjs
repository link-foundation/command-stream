// Splits a shell word into typed parts so that every leaf of the network is
// translated by a rule rather than by ad-hoc string surgery.
//
// A word such as `"${DIR}/$(basename "$1").log"` becomes:
//   literal(")  variable(DIR)  literal(/)  substitution(...)  literal(.log")

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
// The parameter a `${...}` body can start with: a name, a positional number,
// or one of the special parameters.
const PARAMETER = /^(?:[A-Za-z_][A-Za-z0-9_]*|\d+|[@*#?$])/;

const node = (term, children = [], text = undefined) => ({
  term,
  children,
  text,
});
const leaf = (term, text) => node(term, [], text);

/** Merges adjacent literal parts so the output stays compact. */
function compact(parts) {
  const merged = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (part.term === 'literal' && previous?.term === 'literal') {
      previous.text += part.text;
      continue;
    }
    merged.push(part);
  }
  return merged.filter((part) => part.term !== 'literal' || part.text !== '');
}

/**
 * Classifies a `$...` expansion.
 *
 * @param {string} name Variable name or special parameter.
 * @param {Set<string>} declared Names the script assigns itself.
 */
function expansionNode(name, declared) {
  if (/^\d+$/.test(name)) {
    // `$0` is the script itself; `$1` is the first user argument, which is
    // index 0 of `process.argv.slice(2)`. Doing the renumbering here keeps the
    // translation rules free of arithmetic.
    return name === '0'
      ? leaf('script-name', name)
      : leaf('positional', String(Number(name) - 1));
  }
  if (name === '@' || name === '*') {
    return leaf('all-arguments', name);
  }
  if (name === '#') {
    return leaf('argument-count', name);
  }
  if (name === '?') {
    return leaf('exit-status', name);
  }
  if (name === '$') {
    return leaf('process-id', name);
  }
  // A name the script assigns becomes a JavaScript binding; anything else can
  // only come from the environment.
  return leaf(declared.has(name) ? 'variable' : 'env-variable', name);
}

/**
 * Reads the expansion starting at `index`, if there is one.
 *
 * @returns {{part: object, end: number} | null} The expansion node and the
 *   index just past it, or `null` when the character is ordinary text.
 */
function expansionAt(text, index, declared, parseSubstitution) {
  const character = text[index];

  if (character === '`') {
    const end = text.indexOf('`', index + 1);
    const close = end === -1 ? text.length : end;
    const body = parseSubstitution(text.slice(index + 1, close));
    return { part: node('substitution', [body]), end: close + 1 };
  }

  if (character !== '$') {
    return null;
  }

  if (text[index + 1] === '(') {
    const close = matchingParenthesis(text, index + 1);
    const body = parseSubstitution(text.slice(index + 2, close));
    return { part: node('substitution', [body]), end: close + 1 };
  }

  if (text[index + 1] === '{') {
    const close = matchingBrace(text, index + 1);
    const body = text.slice(index + 2, close);
    return { part: braceExpansion(body, declared), end: close + 1 };
  }

  const rest = text.slice(index + 1);
  const match = NAME.exec(rest);
  const name = match ? match[0] : rest.slice(0, 1);
  if (name && (match || '@*#?$'.includes(name) || /^\d$/.test(name))) {
    return {
      part: expansionNode(name, declared),
      end: index + 1 + name.length,
    };
  }
  return null;
}

/**
 * Expands a shell word into part nodes.
 *
 * @param {string} text Raw word text, quotes included.
 * @param {Set<string>} declared Variable names assigned by the script.
 * @param {(source: string) => object} parseSubstitution Parses the body of a
 *   command substitution into a statement node.
 * @returns {object[]} Part nodes.
 */
export function expandWord(text, declared, parseSubstitution) {
  const parts = [];
  let index = 0;
  let literal = '';
  let singleQuoted = false;

  const flush = () => {
    if (literal !== '') {
      parts.push(leaf('literal', literal));
      literal = '';
    }
  };

  while (index < text.length) {
    const character = text[index];

    if (character === "'") {
      singleQuoted = !singleQuoted;
      literal += character;
      index += 1;
      continue;
    }
    // Inside single quotes the shell performs no expansion at all.
    if (singleQuoted) {
      literal += character;
      index += 1;
      continue;
    }
    if (character === '\\') {
      literal += text.slice(index, index + 2);
      index += 2;
      continue;
    }

    const expansion = expansionAt(text, index, declared, parseSubstitution);
    if (expansion) {
      flush();
      parts.push(expansion.part);
      index = expansion.end;
      continue;
    }

    literal += character;
    index += 1;
  }

  flush();
  return compact(parts);
}

/**
 * `${NAME}`, `${NAME:-default}` and `${NAME:=default}` are supported directly;
 * anything more exotic is preserved verbatim as an environment lookup so no
 * information is silently dropped.
 */
function braceExpansion(body, declared) {
  const plain = PARAMETER.exec(body);
  if (plain && plain[0] === body) {
    return expansionNode(body, declared);
  }
  const withDefault = /^(\d+|[@*#?$]|[A-Za-z_][A-Za-z0-9_]*):?[-=](.*)$/s.exec(
    body
  );
  if (withDefault) {
    return node(
      'default-expansion',
      [
        expansionNode(withDefault[1], declared),
        leaf('literal', withDefault[2]),
      ],
      withDefault[1]
    );
  }
  return leaf('unsupported-expansion', body);
}

function matchingParenthesis(text, start) {
  return matchingDelimiter(text, start, '(', ')');
}

function matchingBrace(text, start) {
  return matchingDelimiter(text, start, '{', '}');
}

function matchingDelimiter(text, start, open, close) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) {
      depth += 1;
    } else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return text.length;
}
