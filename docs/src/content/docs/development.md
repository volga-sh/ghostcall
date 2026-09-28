---
title: Development
description: Build, test, and update the ghostcall repository.
---

This page is for contributors working in the ghostcall repository. Run all
commands from the repository root.

Use the Node.js version in `.nvmrc`, npm 12.1.0, and Foundry v1.8.3. CI tests
Node.js 26 and the latest Node.js 24 LTS release. `foundry.toml` pins Solidity
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
- `scripts/generate-sdk-initcode.mjs` copies compiled initcode into the SDK.
- `test/ghostcall.test.ts` tests program behavior against Anvil.
- `test/sdk.test.ts` tests encoding, decoding, validation, and SDK failure
  behavior.

When public behavior changes, update the implementation, generated initcode,
tests, API comments, README, and docs in the same pull request.
