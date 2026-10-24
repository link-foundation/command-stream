export interface TranslationOptions {
  from?:
    | 'auto'
    | 'shell'
    | 'sh'
    | 'bash'
    | 'dash'
    | 'zsh'
    | 'javascript'
    | 'js'
    | 'zx'
    | 'execa'
    | 'shelljs'
    | 'cross-spawn'
    | 'bun';
  filename?: string;
  moduleName?: string;
  shell?: string;
  name?: string;
  shebang?: boolean;
  useM?: boolean;
  commonjs?: boolean;
}
export interface Translation {
  code: string;
  diagnostics: string[];
  network: object;
  ruleSet: { rules: object[] };
}
export function translateSource(
  source: string,
  options?: TranslationOptions
): Translation;
export function translateShellProgram(
  source: string,
  options?: TranslationOptions
): Translation;
export function translateCompetitorSource(
  source: string,
  options?: TranslationOptions
): Translation;
export function translateShellToMjs(
  source: string,
  options?: TranslationOptions
): Translation & { preamble: string; body: string };
export function formalizeShell(source: string): {
  network: object;
  root: object;
  terms: Set<string>;
  names: object;
};
export function parseShellScript(source: string): object;
export function buildRuleSet(options?: { trackExitCode?: boolean }): object;
export class RuleEngine {
  constructor(network: object, ruleSet: object, options?: object);
  render(linkId: object, language?: string): string;
  report(): string[];
}
