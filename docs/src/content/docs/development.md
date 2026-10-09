---
title: Development
description: Instructions for changes to the ghostcall repository.
---

Run each command from the repository root.

Use the Node.js LTS version in `.nvmrc`.
CI uses the same version.
Use npm 12.1.0 and Foundry v1.8.3.
`foundry.toml` sets Solidity 0.8.37.
It also sets the Prague EVM target.

## Install the project

```sh
nvm install
npm install --global npm@12.1.0
npm ci
npm run build:sdk
npm run test
npm run typecheck
npm run check
```

`build:sdk` compiles the Yul program.
It updates the initcode in the SDK.
It does a type check of the SDK build.

## Change the Yul program

```sh
npm run build:contracts
npm run check:sdk:initcode
```

`build:contracts` compiles `src/Ghostcall.yul`.
It updates `src/sdk/generated/initcode.ts`.
Do not edit the generated initcode file.

Run the full test suite after each Yul change.
The integration tests start Anvil.
They run the compiled program in a local EVM.

## Measure SDK performance

```sh
npm run benchmark:sdk
```

The benchmark measures the time to encode, decode, and batch calls.
It does not use network requests.
It gives median times for 1, 100, and 700 calls.
It also gives estimates for memory allocation.
These estimates include temporary objects that the garbage collector removes.
The estimates count the bytes that each batch allocates.
They do not give peak memory use or memory that the program keeps.

Read [Limits](/limits/) to measure the request and response limits of an RPC endpoint.

## Change the docs

```sh
npm ci --prefix docs
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Documentation source files are in `docs/src`.
The docs build writes its output to `docs/dist`.

The docs build does a type check of each `ts twoslash` block against `src/sdk`.
These blocks show editor hover text.
A type error stops the `docs:build` command.
Examples can use the global `client` provider.
Read the [twoslash syntax](https://twoslash.studiocms.dev/) for queries (`// ^?`) and hidden code (`// ---cut---`).

Reference signatures and type definitions use queries on SDK imports.
The docs get the declarations from the SDK.
Do not keep separate declarations in the docs.
Usage examples show types only in hover text.
Do not add queries to usage examples.

The docs use TypeScript 5.9.
twoslash uses the compiler API from that version.
TypeScript 7 does not have this API.
The docs have a peer dependency override for expressive-code-twoslash.
The override uses the expressive-code version from Starlight.
Update this override after a Starlight version change.

npm 12 does not run dependency installation scripts by default.
`docs/package.json` lets npm run the specified esbuild installation script.
fsevents uses its macOS binary.
It does not build this binary during installation.
Do a check of the esbuild approval after a version change.
Update the approval if necessary.

## Write comments and documentation

Use [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) for comments and documentation.
Use active voice.
Put one instruction in each sentence.
Use at most 20 words in a procedural sentence.
Use at most 25 words in a descriptive sentence.
Use approved words and established software terms.
Do not use semicolons or contractions.
Do not put more than three nouns together unless they make a technical term.
Use the same term for the same item.
Do a check of the language before you make a pull request.
API names, file names, EVM instructions, and package names keep their official spelling.
