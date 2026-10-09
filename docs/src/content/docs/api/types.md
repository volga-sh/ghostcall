---
title: Types
description: The public TypeScript types that ghostcall exports.
---

Import types from `@volga-sh/evm-ghostcall`.

```ts twoslash
import type {
	Hex,
// ^?
	GhostcallCall,
// ^?
	GhostcallResult,
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
`0x`-prefixed hex. The SDK does a check of these requirements at runtime. The
types cannot express these requirements. TypeScript does a check of other
options through their types. The SDK sends block numbers and `gas` as RPC hex
quantities.

Only `aggregateCalls()` uses `allowFailure`. Set it to `true` to get a
failed entry without an error. Its default value is `false`.
The default value of `maxInitcodeBytes` is `49,152` bytes for the full CREATE
request. The default value of `ethCall.blockTag` is `"latest"`.

Use either entry form with
[`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/). `GhostcallAbiCall<TAbi>` contains information for an ABI function call.
`GhostcallDecodedCall<TResult>` contains raw calldata and a custom decoder
that returns `TResult`.

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

`aggregateDecodedCalls()` infers the type at each tuple position. This includes
ABI overloads that the arguments select. An ordinary array gives an array of
the result union. An empty tuple gives `[]`. An ABI with a general type gives
`unknown` results.
