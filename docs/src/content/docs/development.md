---
title: Development
description: Build, test, and update the ghostcall repository.
---

This page is for contributors working in the ghostcall repository. Run all
commands from the repository root.

Use the latest Node.js 24 LTS release pinned in `.nvmrc`, npm 12.1.0, and
Foundry v1.8.3. CI also tests Node.js 26. `foundry.toml` pins Solidity
0.8.37 and keeps the Prague EVM target for compatibility.

## Install and check the project

```sh
nvm install
npm install --global npm@12.1.0
npm ci
npm run build:sdk
npm run test
npm run typecheck
npm run check
```

`build:sdk` compiles the Yul program, regenerates the bundled SDK initcode, and
type-checks the SDK build.

## Work on the Yul program

```sh
npm run build:contracts
npm run check:sdk:initcode
```

`build:contracts` compiles `src/Ghostcall.yul` and regenerates
`src/sdk/generated/initcode.ts`. Never edit the generated initcode file by hand.

After a Yul change, run the full test suite. The integration tests start Anvil
and exercise the compiled program on a real local EVM.

## Measure SDK performance

```sh
npm run benchmark:sdk
```

The benchmark measures encoding, decoding, and batching without network latency.
It reports median timings for 1, 100, and 700 calls and sampled allocation
estimates, including temporary objects collected by GC. Allocation figures
measure bytes allocated per batch, not peak or retained memory.

To probe an RPC endpoint's request and response limits, see [Limits](/limits/).

## Work on the docs

```sh
npm ci --prefix docs
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Documentation source files live in `docs/src`. The static build is written to
`docs/dist`.

npm 12 blocks dependency install scripts by default. `docs/package.json` allows
the pinned esbuild binary setup script; fsevents uses its bundled macOS binary
without rebuilding it. Review and update the esbuild approval when its version
changes.

## Repository map

- `src/Ghostcall.yul` contains the EVM program.
- `src/sdk/index.ts` contains the public TypeScript API.
- `src/sdk/abi.ts` turns ABI-described calls into raw calls with decoders.
- `scripts/generate-sdk-initcode.ts` copies compiled initcode into the SDK.
- `scripts/benchmark-sdk.ts` and `scripts/benchmark-limits.ts` measure SDK cost
  and endpoint size limits.
- `test/ghostcall.test.ts` tests program behavior against Anvil.
- `test/sdk.test.ts` tests encoding, decoding, validation, and SDK failure
  behavior.
- `test/abi.test.ts` tests ABI call preparation, overloads, and decoding.
- `test/sdk.typecheck.ts` pins inferred types; `npm run typecheck` checks it.
- `test/benchmark-limits.test.ts` tests the limit benchmark script.

When public behavior changes, update the implementation, generated initcode,
tests, API comments, README, and docs in the same pull request.
