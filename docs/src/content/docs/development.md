---
title: Development
description: Instructions for changes to the ghostcall repository.
---

This page gives instructions for work in the ghostcall repository.
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

## Repository files

- `src/Ghostcall.yul` contains the EVM program.
- `src/sdk/index.ts` contains the public TypeScript API.
- `src/sdk/abi.ts` prepares raw calls and decoders from ABI calls.
- `scripts/generate-sdk-initcode.ts` copies compiled initcode into the SDK.
- `scripts/benchmark-sdk.ts` and `scripts/benchmark-limits.ts` measure SDK processing time and endpoint size limits.
- `test/ghostcall.test.ts` contains the tests for program behavior with Anvil.
- `test/sdk.test.ts` contains the tests for encoding, decoding, validation, and SDK failure behavior.
- `test/abi.test.ts` contains the tests for ABI call preparation, overloads, and decoding.
- `test/sdk.typecheck.ts` gives the specified inferred types. Run `npm run typecheck` to do this check.
- `test/benchmark-limits.test.ts` contains the tests for the limit benchmark script.

Update the implementation, generated initcode, tests, API comments, README, and docs when public behavior changes.

## Write comments and documentation

Use [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) for comments and documentation.
Use active voice.
Put one instruction in each sentence.
Use at most 20 words in a procedural sentence.
Use at most 25 words in a descriptive sentence.
Use approved words and the technical terms below.
Do not use semicolons or contractions.
Do not put more than three nouns together unless they make a technical term.
Use the same term for the same item.
Do a check of the language before you make a pull request.

## Technical terms

These terms have the specified project meanings.
API names, file names, EVM instructions, and package names keep their official spelling.

| Technical noun | Project meaning |
| --- | --- |
| batch | A group of calls in one `eth_call` request. |
| calldata | The bytes that a caller gives to an EVM call. |
| initcode | The code that runs during contract creation. |
| return data | The bytes that an EVM call returns. |
| revert data | The bytes that an EVM call returns when it reverts. |
| wire format | The specified arrangement of fields in request or response bytes. |
| peer dependency override | A package setting that replaces the version requirement from another package. |
| type inference | The TypeScript process that gets types from declarations or expressions. |
| type check | A check of TypeScript types against the program declarations. |
| build | The compiled program files that a build command makes. |
| benchmark | A program that measures processing time, memory allocation, or size limits. |
| memory allocation | The memory that the program gets for its data. |
| garbage collector | The software that removes objects that are no longer necessary for the program. |
| median | The middle value in a sorted set of measurements. |
| hover text | The text that the editor shows when the cursor is above a code expression. |

Use these technical verbs only for their specified computer processes:

| Technical verb | Project meaning |
| --- | --- |
| encode | Write values as bytes in a specified format. |
| decode | Get values from bytes in a specified format. |
| parse | Read fields from text or bytes with a specified structure. |
| compile | Make program code from source code with a compiler. |
| build | Make compiled program files with a build command. |
| install | Put a package or tool on the computer. |
| load | Read data from a file or another source into the program. |
| store | Write data to a memory area or field. |
| copy | Make another instance of data in a specified memory area or file. |
| run | Cause a program or command to do its operations. |
| deploy | Put contract code on the chain. |
| return | Give data back to the caller. |
| revert | Stop an EVM call without keeping its state changes. |
| throw | Give a program error to the caller. |
| infer | Get a TypeScript type from a declaration or expression. |
| allocate | Give memory to program data. |
| batch | Put calls in one `eth_call` request. |
| validate | Do a check of input against the specified rules. |
| optimize | Make the program smaller or decrease its gas use. |
