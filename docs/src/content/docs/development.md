---
title: Development
description: Build, test, and documentation commands for contributors working on ghostcall.
---

Run commands from the repository root.

## Core commands

```sh
npm install
npm run build:contracts
npm run build:sdk
npm run test
npm run typecheck
npm run check
```

`build:contracts` compiles the Yul contract with Foundry and refreshes the generated SDK initcode. If `src/Ghostcall.yul` changes, regenerate `src/sdk/generated/initcode.ts` immediately through the build script.

## Docs commands

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

These root scripts proxy to the Starlight app in `docs/`. Source files live under `docs/src`, and the static build output goes to `docs/dist`.

## Project layout

- `src/Ghostcall.yul` is the protocol implementation and source of truth.
- `src/sdk/index.ts` is the public TypeScript SDK surface.
- `src/sdk/generated/initcode.ts` is generated and must not be hand-edited.
- `scripts/generate-sdk-initcode.mjs` derives bundled initcode from the Foundry artifact.
- `test/ghostcall.test.ts` covers real end-to-end protocol behavior against Anvil.
- `test/sdk.test.ts` covers SDK encoding, decoding, validation, and failure policy.

## Change discipline

Keep Yul, generated initcode, SDK behavior, tests, and docs in lockstep. Public semantic changes should update tests and the docs website in the same change. Keep the README as a concise pointer to the website and core repository commands.

Prefer direct protocol language over convenience abstractions. Ghostcall is meant to stay small, auditable, and clear about wire-format behavior.
