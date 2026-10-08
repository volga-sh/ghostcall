---
title: Types
description: The eight public TypeScript types exported by ghostcall.
---

Import shared SDK types from `@volga-sh/evm-ghostcall`. ghostcall defines and
exports its own `Hex` type and seven call, result, provider, and options types:

| Type | Purpose |
| --- | --- |
| `Hex` | A `0x`-prefixed string, defined by ghostcall. |
| `GhostcallCall` | `{ to: Hex; data: Hex; allowFailure?: boolean }`. Encoding ignores the failure policy; `aggregateCalls()` uses it to decide whether to throw. |
| `GhostcallAbiCall<TAbi>` | An ABI-described call with a function name and typed arguments. |
| `GhostcallDecodedCall<TResult>` | Raw calldata with a custom decoder returning `TResult`. |
| `GhostcallResult` | `{ success: boolean; returnData: Hex }`. |
| `GhostcallProvider` | Any object with a `request({ method, params })` method returning a promise. |
| `GhostcallEncodeOptions` | `{ maxInitcodeBytes?: number }`, defaulting to 49,152 bytes for the full CREATE request. |
| `GhostcallAggregateOptions` | Encoding options plus the outer `ethCall` options below. |

Addresses must contain 20 bytes. Calldata and returndata must be even-length,
`0x`-prefixed hex. The SDK validates these boundaries at runtime.

## Declaring reusable calls

```ts
import type { GhostcallAbiCall } from "@volga-sh/evm-ghostcall";
import { Abi } from "ox";

const abi = Abi.from(["function balanceOf(address owner) view returns (uint256)"]);
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
const calls = [
	{ to: token, abi, functionName: "balanceOf", args: [owner] },
] as const satisfies readonly GhostcallAbiCall<typeof abi>[];
```

Functions with inputs require `args`. ABI calls do not accept `data` or
`decodeResult`; raw decoded calls require both. Neither decoded form accepts
`allowFailure`. Custom decoders receive `(returnData, index)`.

`aggregateDecodedCalls()` infers each tuple position, including argument-selected
ABI overloads. Ordinary arrays produce arrays of the result union, empty tuples
produce `[]`, and broadly typed ABIs loaded at runtime produce `unknown` results.

## Aggregate options

```ts
import type { Hex } from "@volga-sh/evm-ghostcall";

type GhostcallAggregateOptions = {
	maxInitcodeBytes?: number;
	ethCall?: {
		from?: Hex;
		gas?: bigint;
		blockTag?: bigint | "latest" | "earliest" | "pending" | "safe" | "finalized";
	};
};
```

The block defaults to `"latest"`. Block numbers and `gas` are sent as RPC hex
quantities. Options apply to the whole batch.
