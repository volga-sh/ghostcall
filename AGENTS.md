# agents.md

This file gives project instructions for coding agents in the `ghostcall` repository.

## Project Overview

`ghostcall` is a small Yul and TypeScript SDK for CREATE-style `eth_call` batches.

## Key Commands

Run all commands from the repository root.

```bash
npm run build:contracts      # Compile the Yul program and update the SDK initcode.
npm run build:sdk            # Compile the Yul program and SDK to dist/.
npm run generate:sdk:initcode
npm run check               # Do lint and static checks with Biome.
npm run check:fix            # Correct Biome issues where possible.
npm run format              # Format files with Biome.
npm run typecheck           # Do the TypeScript type checks.
npm run test                # Compile the Yul program and run all Node tests.
npm run check:sdk:initcode   # Do a check of the generated initcode.
```

## Architecture

### Core Structure

- `src/Ghostcall.yul` is initcode. It gives the protocol behavior, request parsing, result format, and CREATE return limits.
- `src/sdk/index.ts` contains the wire format and batch APIs. Keep SDK support for different providers. Keep the raw calldata APIs.
- `src/sdk/abi.ts` prepares ABI calls for the wire format. Use ox for ABI encoding, decoding, and types. Do not make another codec.
- `scripts/generate-sdk-initcode.ts` gets the SDK initcode from the Foundry artifact. Correct generator errors in the source or generator.
- `test/support/` contains RPC, Anvil, ABI, and artifact functions for integration tests.
- `docs/` gives the public protocol and SDK behavior. Update the docs when this behavior changes. Keep `README.md` short, with a link to the docs.

### Design Principles

- Keep the public SDK small. Encode calls, decode results, and add little else.
- Make sure the protocol is correct before you add convenience functions.
- Keep the SDK as a translation layer. Do not turn it into a framework.
- Do not add abstractions that hide protocol rules, byte limits, call order, failure behavior, or transport requirements.
- Keep the implementation easy to read. Make the EVM operations and wire format clear in the code.
- Use smaller or faster code only when size or gas limits make that change necessary.
- Examine the alternatives before you optimize the code. Record the reason for each optimization.

### API Design Principles

- Use names that show the function behavior.
- Use clear data structures instead of defaults with unclear behavior.
- Use clear return types. Keep the return format stable.
- Show limits and failure behavior in names, types, docs, or thrown errors.

## Workflow Rules

1. Give the user or protocol result before you change the code.
2. Read the applicable Yul, SDK, tests, and docs before you change the behavior.
3. Complete one protocol or API change at a time.
4. Update the tests with the implementation change. Make sure the Yul, generated initcode, SDK, tests, and documentation examples agree.
5. After a `src/Ghostcall.yul` change, regenerate `src/sdk/generated/initcode.ts` immediately.
6. Run applicable checks often. Use `npm run build:contracts`, `npm run test`, `npm run typecheck`, and `npm run check`.
7. Find unusual cases early. Include empty batches, incorrect requests, size limits, revert data, and result order.
8. Ask for clarification if the protocol behavior is not clear. Do not invent that behavior.
9. Explain the reasons for EVM offsets, bit packing, memory layouts, and size limits in comments.
10. Use the real EVM and JSON-RPC to do a check of behavior that is not clear.
11. After you create or update a pull request, examine the full diff for simpler code and repeated content.

## Tests

- Use `npm run test` as the usual check after a behavior change.
- Use a real temporary Anvil instance in `test/ghostcall.test.ts` for protocol behavior instead of mocks.
- Use `test/sdk.test.ts` for direct tests of SDK encoding, decoding, and validation.
- Make sure each test can run independently. Make sure each test is clear.
- Use `test/support/` functions for repeated chain setup, ABI operations, and RPC operations.
- Wait for a transaction receipt before you do a check of its state changes.
- Add a regression test for each bug in request parsing, result decoding, or size limits.

## Best Practices

### Documentation and Examples

- Give each public SDK function correct JSDoc.
- Keep examples short. Make sure they run. Keep the subject on `ghostcall` instead of provider setup.
- Use `ts twoslash` blocks for TypeScript documentation examples.
- `npm run docs:build` does type checks against `src/sdk`. Run it after a public type or signature change.
- Give short comments or docstrings for internal functions with rules that are not clear from the code.

Use [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) for all comments and documentation.
Use the language rules in `docs/src/content/docs/development.md`.

Add ASCII diagrams to comments for memory areas, pointers, offsets, and temporary bytes when the layout is not clear.
Show the input area and result area separately.
Show which bytes the next instruction can overwrite.

### TypeScript Rules

- Use strict types. Do not use `any`.
- Use `type` aliases unless an `interface` is clearly better.
- Give each exported function a return type.
- Declare and export shared primitive types, for example `Hex`, in the SDK.
- Import these types from ghostcall in examples and tests.
- Put exports at the end of each handwritten TypeScript file. Do not put `export` on each declaration.
- Generated files can use the format from their generator.
- Do not add runtime validation for values that the types already show.
- This rule applies to public and internal APIs. Examples are the `bigint` type of `gas` and named `blockTag` values.
- Callers that do not obey the types get provider errors.
- Add runtime checks only for rules that types cannot show and that affect ghostcall bytes.
- These rules include address length, hex format and prefix, size limits, and the untyped RPC response.
- Use assertions or wrappers only to give a more specific external input type or solve third-party type limits.

### Generated Artifacts

- Do not edit `src/sdk/generated/initcode.ts` manually.
- If it changes unexpectedly, examine `src/Ghostcall.yul`, the Foundry artifacts, and `scripts/generate-sdk-initcode.ts`.

## Common Patterns

### SDK Boundary Pattern

The wire format APIs accept and return raw `0x`-prefixed hex strings.
The decoded batch API also accepts ABI calls.
The SDK infers argument and result types from the same function definition.
Keep ABI calls and raw calls as clear, separate forms.
Keep support for custom decoders.

### Validation Pattern

The Yul program does not do a check of request bytes.
This keeps the initcode small.
The SDK does the request validation.
`encodeCalls()` must reject values that the program cannot read correctly.
Examples are incorrect hex, incorrect addresses, and calldata that is too large.

### Error Handling Pattern

- Reject incorrect caller input immediately.
- Keep the specified call order and result byte format.
- Give provider and transport errors to the caller unless added information makes the error clear.
- Make the protocol failure behavior clear.
- Record subcall failures as result entries.
- Give outer call failures and CREATE policy failures to the caller through the provider.

## Security

### Critical Safety Requirements

1. Treat encoding, decoding, and ordering bugs as security issues.
2. Reject incorrect input, incorrect response headers, and responses with missing bytes in the SDK.
3. Stop the full request if the result length is too large for its header.
4. Make sure size limits agree with the wire format and active CREATE policy.
5. Obey wire format limits as protocol requirements.
6. Give names and explanations for bit packing, offsets, and size constants.
7. Add tests and documentation updates with each public behavior change.

## Developer Notes

- Use lowercase `ghostcall` for the project or protocol name in prose.
- Use `Ghostcall...` for exported TypeScript type and symbol names where applicable.

## File Scope Rules

Keep this file as general work instructions for this repository.
Put temporary TODOs and changing implementation details in code or pull request discussions.
