---
title: Types
description: The public TypeScript types exported by ghostcall.
---

Import types from `@volga-sh/evm-ghostcall`. Function pages link here instead of
repeating these definitions.

```ts twoslash
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
// ---cut-after---
// Fail the docs build if these definitions drift from the SDK's exports.
import type * as Exported from "@volga-sh/evm-ghostcall";
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const matchesSdk: [
	Equal<Hex, Exported.Hex>,
	Equal<GhostcallCall, Exported.GhostcallCall>,
	Equal<GhostcallResult, Exported.GhostcallResult>,
	Equal<GhostcallProvider, Exported.GhostcallProvider>,
	Equal<GhostcallEncodeOptions, Exported.GhostcallEncodeOptions>,
	Equal<GhostcallAggregateOptions, Exported.GhostcallAggregateOptions>,
] = [true, true, true, true, true, true];
```

Addresses must contain 20 bytes. Calldata and returndata must be even-length,
`0x`-prefixed hex. The SDK checks these at runtime because the types cannot
express them; every other option is checked only by its type. Block numbers and
`gas` are sent as RPC hex quantities.

`GhostcallAbiCall<TAbi>` and `GhostcallDecodedCall<TResult>` are the two entry
forms accepted by [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/): an
ABI function call, or raw calldata with a custom decoder returning `TResult`.

## Declaring reusable calls

```ts twoslash
import type { GhostcallProvider } from "@volga-sh/evm-ghostcall";
declare const client: GhostcallProvider;
// ---cut---
import {
	aggregateDecodedCalls,
	type GhostcallAbiCall,
} from "@volga-sh/evm-ghostcall";
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
