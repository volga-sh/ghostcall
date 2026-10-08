---
title: Types
description: The public TypeScript types exported by ghostcall.
---

Import types from `@volga-sh/evm-ghostcall`. Function pages link here instead of
repeating these definitions.

```ts
type Hex = `0x${string}`;

type GhostcallCall = {
	to: Hex;
	data: Hex;
	// aggregateCalls() only: return this failure instead of throwing.
	allowFailure?: boolean;
};

type GhostcallResult = { success: boolean; returnData: Hex };

type GhostcallProvider = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

type GhostcallEncodeOptions = {
	maxInitcodeBytes?: number; // Default: 49,152, the full CREATE request.
};

type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	ethCall?: {
		from?: Hex;
		gas?: bigint;
		// Default: "latest".
		blockTag?: bigint | "latest" | "earliest" | "pending" | "safe" | "finalized";
	};
};
```

Addresses must contain 20 bytes. Calldata and returndata must be even-length,
`0x`-prefixed hex. The SDK validates these values at runtime. Block numbers and
`gas` are sent as RPC hex quantities.

`GhostcallAbiCall<TAbi>` and `GhostcallDecodedCall<TResult>` are the two entry
forms accepted by [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/): an
ABI function call, or raw calldata with a custom decoder returning `TResult`.

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

`aggregateDecodedCalls()` infers each tuple position, including argument-selected
ABI overloads. Ordinary arrays produce arrays of the result union, empty tuples
produce `[]`, and broadly typed ABIs loaded at runtime produce `unknown` results.
