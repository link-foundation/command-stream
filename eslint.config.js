// ESLint resolves its configuration by walking up from the working directory,
// and treats the directory holding that file as the root of the linted project.
// Keeping the file here is what puts repository-root JavaScript — the
// experiments/ reproductions and claude-profiles.mjs — inside the lint scope;
// while the configuration lived in js/, those files could not be linted at all
// ("the file is ignored because it is located outside of the base path").
//
// The rules themselves stay next to the code and the node_modules they import
// from, so this file only re-exports them.
export { default } from './js/eslint.config.js';
