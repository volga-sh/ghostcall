---
title: Types
description: The public TypeScript types exported by ghostcall.
---

Import types from `@volga-sh/evm-ghostcall`. Function pages link here instead of
repeating these definitions.

```ts twoslash
import type {
	Hex,
// ^?
	GhostcallCall,
// ^?
	GhostcallResult,
// ^?
	GhostcallDecodedResult,
// ^?
	GhostcallProvider,
// ^?
	GhostcallEncodeOptions,
// ^?
	GhostcallAggregateOptions,
// ^?
} from "@volga-sh/evm-ghostcall";
```

Addresses must contain 20 bytes. Calldata and returndata must be even-length,
`0x`-prefixed hex. The SDK checks these at runtime because the types cannot
express them; every other option is checked only by its type. Block numbers and
`gas` are sent as RPC hex quantities.

`allowFailure` defaults to `false`, so a failed call throws. Set it to `true`
on an `aggregateCalls()` entry to return its `GhostcallResult` with
`success: false`. Set it to `true` on an `aggregateDecodedCalls()` entry to
receive a `GhostcallDecodedResult` at that position; a failure carries the
`GhostcallSubcallError` that the entry would otherwise throw.
`maxInitcodeBytes` defaults to `49,152` bytes for the full CREATE request.
`ethCall.blockTag` defaults to `"latest"`.

`GhostcallAbiCall<TAbi, TAllowFailure>` and
`GhostcallDecodedCall<TResult, TAllowFailure>` are the two entry forms accepted
by [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/): an ABI function
call, or raw calldata with a custom decoder returning `TResult`.

`TAllowFailure` is the entry's failure policy, because `allowFailure` decides
the shape of its result. It defaults to `false`, which rejects
`allowFailure: true`. `true` requires `allowFailure: true` and yields a
`GhostcallDecodedResult`. `boolean` accepts either and yields either shape.

## Declaring reusable calls

```ts twoslash
import { aggregateDecodedCalls, type GhostcallAbiCall } from "@volga-sh/evm-ghostcall";
import { Abi } from "ox";

const abi = Abi.from(["function balanceOf(address owner) view returns (uint256)"]);
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
const calls = [
	{ to: token, abi, functionName: "balanceOf", args: [owner] },
] as const satisfies readonly GhostcallAbiCall<typeof abi>[];

const results = await aggregateDecodedCalls(client, calls);
```

`aggregateDecodedCalls()` infers each tuple position, including argument-selected
ABI overloads. Ordinary arrays produce arrays of the result union, empty tuples
produce `[]`, and broadly typed ABIs loaded at runtime produce `unknown` results.

Pass `true` as `TAllowFailure` to declare calls that may fail:

```ts twoslash
import { aggregateDecodedCalls, type GhostcallAbiCall } from "@volga-sh/evm-ghostcall";
import { Abi } from "ox";

const abi = Abi.from(["function symbol() view returns (string)"]);
const tokens = [
	"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
	"0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
] as const;
const calls: GhostcallAbiCall<typeof abi, true>[] = tokens.map((to) => ({
	to,
	abi,
	functionName: "symbol",
	allowFailure: true,
}));

const symbols = await aggregateDecodedCalls(client, calls);
```
