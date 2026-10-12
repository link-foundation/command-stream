# Issue #30 and PR #116 reconciliation

The issue requests packages, composition/inheritance, async generators,
middleware/plugins, typed interfaces, hot reload, install/create/extend, and
marketplace search. The October 12 review asks for complete tests and documentation.
There are no issue conversation comments or inline PR review comments.

PR #225 already implemented these capabilities on main, and closed #30. This
older branch contained mock npm packages, a hard-coded marketplace, metadata
stored as executable registry entries, and an incompatible copy of the former
monolithic runner. Reintroducing that copy would discard subsequent fixes.
The merge follows main's js/rust layout, keeps its real package ecosystem, and
replaces the unmerged mock tests/examples with acceptance coverage and working
local-package demonstrations. The complete API and requirement-to-test matrix
is in js/docs/VIRTUAL-COMMAND-ECOSYSTEM.md.

The maintained APIs return command handlers from create, installed handles from
install, and metadata arrays from marketplace.search. Middleware uses
(context,next); composition returns a handler that is registered with create.
Hot reload uses installed.reload or dev with packages. The earlier PR description
advertised different interfaces backed by simulations; it is replaced with the
actual supported contracts. Existing published APIs, including create(options),
remain available.

The remaining reproducible bug is JavaScript overload selection: create(null,
handler) returns a configured tag instead of rejecting an invalid name. Internal
createCommand additionally coerces null, undefined, booleans and arrays through
the name regex. Explicit string validation and selection of command registration
when a second argument is supplied fix both paths. Six new tests fail before the
fix; the exact output is saved as name-validation-before.log.gz. Finite experiments
in experiments/issue-30/name-validation.mjs verify ESM/CommonJS in Node and Bun.

The source fix addresses JavaScript overloads and coercion. Rust accepts &str
names and typed closures, so it cannot express these invalid calls. The repository's
parity-exempt label is appropriate for this JavaScript-specific validation fix;
portable ecosystem behavior remains covered by main's Rust tests and executable
language parity checks.

Ten standalone command packages are included and installable. Independent npm
publication, external adoption, and enterprise usage remain post-release success
metrics. This PR does not claim or perform those actions. The JavaScript patch
changeset prepares a release without rolling version 2.4.0 back to the obsolete
branch's 0.8.0.
