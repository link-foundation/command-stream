//! Formalizes a shell script as a meta-language links network.
//!
//! This is the first half of the translation pipeline the way
//! link-foundation/meta-language models it: source text becomes a network of
//! typed links (`LinkType::Syntax` nodes over `LinkType::Token` leaves). The
//! second half — [`super::rules`] plus [`super::engine`] — rewrites that
//! network into JavaScript purely by substitution rules.

use std::collections::{HashSet, VecDeque};

use meta_language::language_profile::LanguageProfile;
use meta_language::link_network::{LinkId, LinkNetwork, LinkType};

use super::parser::{parse_shell_script, Node};
use super::word_expander::expand_word;

/// The language name used for every shell link in the network.
pub const SHELL_LANGUAGE: &str = "Shell";

/// Term of the nodes used to work around meta-language's fixed-arity insertion
/// API (see `js/docs/meta-language-gaps.md`). The engine flattens them, so they
/// are invisible to the rules.
pub const CHUNK_TERM: &str = "chunk";

/// The largest arity [`LinkNetwork::insert_syntax_node`] is instantiated for
/// here. `insert_syntax_node` is const-generic and there is no public
/// dynamic-arity insertion, so wider nodes are chunked.
const MAX_ARITY: usize = 8;

/// Node terms that carry their own text (materialised as a leading token child).
const TEXT_BEARING: [&str; 18] = [
    "assignment",
    "export",
    "local",
    "comment",
    "name",
    "literal",
    "variable",
    "env-variable",
    "positional",
    "script-name",
    "all-arguments",
    "argument-count",
    "exit-status",
    "process-id",
    "unsupported-expansion",
    "default-expansion",
    "pattern",
    "redirect",
];

/// The variable names a script binds, split by how they must be declared in
/// JavaScript.
#[derive(Debug, Default, Clone)]
pub struct DeclaredNames {
    /// Every name that becomes a JavaScript variable, in first-seen order.
    pub bound: Vec<String>,
    /// The subset already declared at its use site (`local`, `for` variables).
    pub locals: HashSet<String>,
}

impl DeclaredNames {
    fn bind(&mut self, name: &str) {
        if !self.bound.iter().any(|bound| bound == name) {
            self.bound.push(name.to_string());
        }
    }

    /// The names of [`Self::bound`] that still need a hoisted declaration.
    pub fn hoisted(&self) -> Vec<&str> {
        self.bound
            .iter()
            .filter(|name| !self.locals.contains(*name))
            .map(String::as_str)
            .collect()
    }
}

/// Collects the variable names the script binds.
///
/// `export X=v` deliberately does not create a binding: it writes to the
/// environment, so `$X` must translate to `process.env.X`.
fn collect_declared_names(tree: &Node, names: &mut DeclaredNames) {
    if let Some(text) = tree.text.as_deref() {
        if tree.term == "assignment" || tree.term == "local" {
            names.bind(text);
            if tree.term == "local" {
                names.locals.insert(text.to_string());
            }
        }
    }
    if tree.term == "for" {
        if let Some(text) = tree
            .children
            .first()
            .and_then(|child| child.text.as_deref())
        {
            names.bind(text);
            names.locals.insert(text.to_string());
        }
    }
    for child in &tree.children {
        collect_declared_names(child, names);
    }
}

/// Rewrites every `word` leaf into a `word` node of typed parts.
fn expand_words(tree: Node, declared: &HashSet<String>) -> Node {
    if tree.term == "word" {
        let parse_substitution = |source: &str| {
            let parsed = parse_shell_script(source);
            expand_words(parsed, declared)
        };
        let parts = expand_word(
            tree.text.as_deref().unwrap_or_default(),
            declared,
            &parse_substitution,
        );
        return Node::new("word", parts);
    }
    Node {
        term: tree.term,
        text: tree.text,
        children: tree
            .children
            .into_iter()
            .map(|child| expand_words(child, declared))
            .collect(),
    }
}

/// The capability profile of the shell dialect this translator formalizes.
///
/// Declaring it in the network makes the supported surface queryable rather
/// than implicit, and `validate_network` then rejects anything outside it.
pub fn shell_profile(concepts: &[String]) -> LanguageProfile {
    let mut profile = LanguageProfile::new("command-stream shell", SHELL_LANGUAGE)
        .with_link_type(LinkType::Syntax)
        .with_link_type(LinkType::Token)
        .with_link_type(LinkType::Semantic);
    for concept in concepts {
        profile = profile.with_concept(concept.clone());
    }
    profile
}

/// Inserts a syntax node of any arity.
///
/// `insert_syntax_node` takes a fixed-size array, so children beyond
/// [`MAX_ARITY`] are grouped into nested [`CHUNK_TERM`] nodes that the rule
/// engine flattens again.
fn insert_syntax_node(network: &mut LinkNetwork, term: &str, children: Vec<LinkId>) -> LinkId {
    if children.len() > MAX_ARITY {
        let mut queue: VecDeque<LinkId> = children.into();
        let mut grouped = Vec::new();
        while !queue.is_empty() {
            let chunk: Vec<LinkId> = queue.drain(..queue.len().min(MAX_ARITY)).collect();
            grouped.push(insert_syntax_node(network, CHUNK_TERM, chunk));
        }
        return insert_syntax_node(network, term, grouped);
    }

    // Slots past `count` are never referenced by the inserted node.
    let mut fixed = [LinkId::from_u64(0); MAX_ARITY];
    let count = children.len();
    fixed[..count].copy_from_slice(&children);

    match count {
        0 => network.insert_syntax_node(SHELL_LANGUAGE, term, []),
        1 => network.insert_syntax_node(SHELL_LANGUAGE, term, [fixed[0]]),
        2 => network.insert_syntax_node(SHELL_LANGUAGE, term, [fixed[0], fixed[1]]),
        3 => network.insert_syntax_node(SHELL_LANGUAGE, term, [fixed[0], fixed[1], fixed[2]]),
        4 => network.insert_syntax_node(
            SHELL_LANGUAGE,
            term,
            [fixed[0], fixed[1], fixed[2], fixed[3]],
        ),
        5 => network.insert_syntax_node(
            SHELL_LANGUAGE,
            term,
            [fixed[0], fixed[1], fixed[2], fixed[3], fixed[4]],
        ),
        6 => network.insert_syntax_node(
            SHELL_LANGUAGE,
            term,
            [fixed[0], fixed[1], fixed[2], fixed[3], fixed[4], fixed[5]],
        ),
        7 => network.insert_syntax_node(
            SHELL_LANGUAGE,
            term,
            [
                fixed[0], fixed[1], fixed[2], fixed[3], fixed[4], fixed[5], fixed[6],
            ],
        ),
        _ => network.insert_syntax_node(SHELL_LANGUAGE, term, fixed),
    }
}

/// A formalized shell script.
pub struct Formalization {
    pub network: LinkNetwork,
    /// The `script` root link.
    pub root: LinkId,
    /// Every node term used, so callers can build the right preamble.
    pub terms: HashSet<String>,
    pub names: DeclaredNames,
}

fn insert_tree(network: &mut LinkNetwork, node: &Node, terms: &mut HashSet<String>) -> LinkId {
    terms.insert(node.term.clone());
    let mut children = Vec::new();
    if TEXT_BEARING.contains(&node.term.as_str()) || node.text.is_some() {
        children
            .push(network.insert_source_token(SHELL_LANGUAGE, node.text.as_deref().unwrap_or("")));
    }
    for child in &node.children {
        children.push(insert_tree(network, child, terms));
    }
    insert_syntax_node(network, &node.term, children)
}

/// Formalizes shell source as a links network.
pub fn formalize_shell(source: &str) -> Formalization {
    let parsed = parse_shell_script(source);
    let mut names = DeclaredNames::default();
    collect_declared_names(&parsed, &mut names);

    let declared: HashSet<String> = names.bound.iter().cloned().collect();
    let tree = expand_words(parsed, &declared);

    let mut network = LinkNetwork::new();
    let mut terms = HashSet::new();
    let root = insert_tree(&mut network, &tree, &mut terms);

    Formalization {
        network,
        root,
        terms,
        names,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_typed_network() {
        let formalization = formalize_shell("NAME=world\necho \"hi $NAME\"\n");
        assert!(formalization.terms.contains("assignment"));
        assert!(formalization.terms.contains("variable"));
        assert_eq!(formalization.names.bound, vec!["NAME".to_string()]);

        let root = formalization
            .network
            .link(formalization.root)
            .expect("root link exists");
        assert_eq!(root.metadata().term(), Some("script"));
        assert_eq!(root.metadata().link_type(), Some(LinkType::Syntax));
    }

    #[test]
    fn chunks_nodes_wider_than_the_fixed_insertion_arity() {
        let commands: String = (0..20)
            .map(|index| format!("echo {index}\n"))
            .collect::<Vec<_>>()
            .concat();
        let formalization = formalize_shell(&commands);
        let root = formalization
            .network
            .link(formalization.root)
            .expect("root link exists");
        // 20 statements do not fit in one fixed-arity node, so they are grouped.
        assert!(root.references().len() <= MAX_ARITY);
        assert!(formalization.terms.contains("command"));
    }

    #[test]
    fn the_profile_accepts_the_formalized_network() {
        let formalization = formalize_shell("ls | wc -l\n");
        let concepts: Vec<String> = formalization.terms.iter().cloned().collect();
        assert!(shell_profile(&concepts)
            .validate_network(&formalization.network)
            .is_ok());
    }
}
