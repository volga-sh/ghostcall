---
title: Types
description: The seven public TypeScript types exported by ghostcall.
---

Import shared SDK types from `@volga-sh/evm-ghostcall`. ghostcall defines and
exports its own `Hex` type and six call, result, and options types:

| Type | Purpose |
| --- | --- |
| `Hex` | A `0x`-prefixed string, defined by ghostcall. |
| `GhostcallCall` | `{ to: Hex; data: Hex; allowFailure?: boolean }`. Encoding ignores the failure policy; `aggregateCalls()` uses it to decide whether to throw. |
| `GhostcallAbiCall<TAbi>` | An ABI-described call with a function name and typed arguments. |
| `GhostcallDecodedCall<TResult>` | Raw calldata with a custom decoder returning `TResult`. |
| `GhostcallResult` | `{ success: true; returnData: Hex } \| { success: false; returnData: Hex }`. |
| `GhostcallEncodeOptions` | `{ maxInitcodeBytes?: number }`, defaulting to 49,152 bytes for the full CREATE request. |
| `GhostcallAggregateOptions` | Encoding options plus the outer `ethCall` options below. |

Addresses must contain 20 bytes. Calldata and returndata must be even-length,
`0x`-prefixed hex. RPC quantities such as `gas` use canonical hex without leading
zeroes (except `0x0`). The SDK validates these boundaries at runtime.

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
`allowFailure`. Custom decoders receive `(returnData, successfulEntry, index)`.

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
		gas?: Hex;
		blockTag?: string | number | bigint;
	};
};
```

The block defaults to `"latest"`; decimal block numbers are normalized to hex.
Providers need only a `request({ method, params })` method returning a promise.

## Migrating type imports

`GhostcallAggregateCall` is now `GhostcallCall`. `Hex` remains a ghostcall export;
use it in place of the removed `HexQuantity` alias. Other helper types are internal.
Use TypeScript utilities when an explicit derived type is needed:

```ts
import type { aggregateCalls, GhostcallResult } from "@volga-sh/evm-ghostcall";

type Provider = Parameters<typeof aggregateCalls>[0];
type SuccessfulResult = Extract<GhostcallResult, { success: true }>;
type FailedResult = Extract<GhostcallResult, { success: false }>;
```

The four SDK functions and `GhostcallSubcallError` keep their runtime exports.
