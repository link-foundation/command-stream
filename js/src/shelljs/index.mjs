import { execaSync } from 'execa';
import { globbySync } from '../zx/vendor/glob.mjs';
import runtime from './runtime.cjs';
import shelljs from './index.cjs';

runtime.configure({ execaSync, globbySync });
export default shelljs;
