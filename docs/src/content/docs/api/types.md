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

`allowFailure` applies only to `aggregateCalls()`: set it to `true` to return a
failed entry instead of throwing. It defaults to `false`.
`maxInitcodeBytes` defaults to `49,152` bytes for the full CREATE request.
`ethCall.blockTag` defaults to `"latest"`.

`GhostcallAbiCall<TAbi>` and `GhostcallDecodedCall<TResult>` are the two entry
forms accepted by [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/): an
ABI function call, or raw calldata with a custom decoder returning `TResult`.

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
//    ^?
```

`aggregateDecodedCalls()` infers each tuple position, including argument-selected
ABI overloads. Ordinary arrays produce arrays of the result union, empty tuples
produce `[]`, and broadly typed ABIs loaded at runtime produce `unknown` results.
