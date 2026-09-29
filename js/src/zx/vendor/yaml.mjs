// A dependency-free YAML 1.2 implementation exposing the public surface of
// the `yaml` v2 package: parse / stringify, documents, node classes, visitors
// and a simplified streaming (Lexer / Parser / Composer) layer.

import * as api from './yaml-api.mjs';

export * from './yaml-api.mjs';

export default { ...api };
