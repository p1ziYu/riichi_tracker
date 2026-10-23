# Engine golden vectors

Run from the repository root:

```sh
node packages/mobile-engine/tools/golden-gen/generate.mjs
```

Requires `pnpm`, Node.js, and the engine dependencies already installed. The runner verifies the pinned `packages/engine/src/index.ts` SHA-256 and a clean tracked `packages/`/`apps/` tree, builds only `@riichi/engine`, and checks tracked files again. It copies `packages/engine/dist` into `~/golden-scratch/engine-dist`; the copied `index.js` becomes `index.real.js` and the recorder in `wrapper.mjs` becomes the scratch `index.js`. Compiled tests already import `../index.js`; no test import adaptation is needed. Each compiled test runs separately under `node --test`, with the original test assertions intact. The three unit files append to one fixture file in run order; the seeded property file writes another. `supplementary.mjs` supplies authored input gaps to that same real compiled engine via the recorder, including deliberate validation failures and chained settlement outputs. No production process, API, database, or web/mobile app is invoked.

The recorder snapshots arguments before the call and synchronously appends the returned value or thrown error afterward. IDs are per-file sequences; source identifies the originating test file and property master seed (hand `0x53b01e42`, terminal `0x71e2a1f0`). `tags` identify the source and, for supplementary inputs, the policy category. A thrown `Error` from compiled engine code is labeled `engine-validation`; native `TypeError`/`RangeError` is `host-type`; other errors are `other`. These are harness classifications, not engine exports. Values are recursively JSON encoded: bigint, undefined, NaN, infinities, and negative zero receive `$type` markers; arrays preserve order and object properties preserve their presence (including explicit undefined).

The runner publishes `golden/fixtures-{unit,property,supplementary}.jsonl` and `golden/manifest.json` only after all test processes and authored calls finish. The manifest contains version/source/commit pins, operation counts, total, and SHA-256 per fixture file. Scratch contents are recreated on each run; consecutive runs at the same commit should yield identical fixture hashes. Avoid hand-editing fixtures; regenerate after an intentional engine change and update the pinned source hash with review.
