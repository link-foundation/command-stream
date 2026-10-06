import type {
  Options,
  SyncOptions,
  ResultPromise,
  SyncResult,
  ExecaMethod,
  ExecaSyncMethod,
  ExecaNodeMethod,
  ExecaScriptMethod,
} from 'execa' with { 'resolution-mode': 'import' };

type Upstream = typeof import('execa', {
  with: { 'resolution-mode': 'import' },
});
type Merge<Previous, Next> = Omit<Previous, keyof Next> & Next;
type SyncBound<Bound extends Options> = Bound extends SyncOptions
  ? Bound
  : SyncOptions;
type Methods =
  | 'execa'
  | 'execaSync'
  | 'execaNode'
  | 'execaCommand'
  | 'execaCommandSync'
  | '$';

// Execa does not export the command-string method types. Keep their three
// overloads here while reusing its public result and option types.
interface CommandMethod<Bound extends Options> {
  <const Next extends Options>(
    options: Next
  ): CommandMethod<Merge<Bound, Next>>;
  <const Next extends Options = {}>(
    command: string,
    options?: Next
  ): ResultPromise<Merge<Bound, Next>>;
  (strings: TemplateStringsArray): ResultPromise<Bound>;
}
interface CommandSyncMethod<Bound extends SyncOptions> {
  <const Next extends SyncOptions>(
    options: Next
  ): CommandSyncMethod<Merge<Bound, Next>>;
  <const Next extends SyncOptions = {}>(
    command: string,
    options?: Next
  ): SyncResult<Merge<Bound, Next>>;
  (strings: TemplateStringsArray): SyncResult<Bound>;
}

export type ExecaCompatibilityApi<Bound extends Options = {}> = Omit<
  Upstream,
  Methods
> & {
  execa: ExecaMethod<Bound>;
  execaSync: ExecaSyncMethod<SyncBound<Bound>>;
  execaNode: ExecaNodeMethod<Bound>;
  execaCommand: CommandMethod<Bound>;
  execaCommandSync: CommandSyncMethod<SyncBound<Bound>>;
  $: ExecaScriptMethod<Bound>;
  create<const Next extends Options = {}>(
    options?: Next
  ): ExecaCompatibilityApi<Merge<Bound, Next>>;
  isExecaChildProcess: typeof isExecaChildProcess;
};
export function execaCompat<const Bound extends Options = {}>(
  options?: Bound
): ExecaCompatibilityApi<Bound>;
export function create<const Bound extends Options = {}>(
  options?: Bound
): ExecaCompatibilityApi<Bound>;
export function isExecaChildProcess(value: unknown): value is ResultPromise;
