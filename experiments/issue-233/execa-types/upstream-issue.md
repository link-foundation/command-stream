Since v10.2.0, TypeScript reports an error inside Execa's own declarations when a project enables `exactOptionalPropertyTypes` and does not use `skipLibCheck`. v10.1.1 type-checks cleanly with the same setup.

### Reproduction

`package.json`:

```json
{
  "type": "module",
  "dependencies": { "execa": "10.2.0" },
  "devDependencies": { "@types/node": "26.6.5", "typescript": "7.0.2" }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "module": "nodenext",
    "target": "es2022",
    "noEmit": true,
    "skipLibCheck": false,
    "types": ["node"]
  }
}
```

`index.ts`:

```ts
import { execa } from 'execa';

await execa('echo', ['hi']);
```

`npx tsc -p .`:

```
node_modules/execa/types/return/result-all.d.ts(29,21): error TS2344: Type 'Omit<OptionsType, "buffer"> & { buffer: { stdout: BufferStdout; stderr: BufferStderr; }; }' does not satisfy the constraint 'CommonOptions'.
  Types of property 'preferLocal' are incompatible.
    Type 'OptionsType["preferLocal"]' is not assignable to type 'boolean'.
      Type 'boolean | undefined' is not assignable to type 'boolean'.
        Type 'undefined' is not assignable to type 'boolean'.
```

| execa  | `exactOptionalPropertyTypes: true` | `exactOptionalPropertyTypes: false` |
| ------ | ---------------------------------- | ----------------------------------- |
| 10.1.0 | passes                             | passes                              |
| 10.1.1 | passes                             | passes                              |
| 10.2.0 | TS2344                             | passes                              |

TypeScript 6.0.3 reports the same error.

### Cause

`ResultAllBuffered` in `types/return/result-all.d.ts` (added in f5772f3) passes `Omit<OptionsType, 'buffer'> & {buffer: …}` to `ResultAllOutput<OptionsType extends CommonOptions>`. For a generic `OptionsType`, `Omit` yields `OptionsType['preferLocal']`, which is `boolean | undefined`. Under `exactOptionalPropertyTypes`, that does not satisfy the optional `readonly preferLocal?: boolean` in `CommonOptions`.
