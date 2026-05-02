---
title: aggregateCalls
description: Send a ghostcall batch and return raw success or failure result entries.
---

Sends one CREATE-style `eth_call` and returns raw result entries in request order.

Use this when you need `success` flags, revert data, or per-call `allowFailure`.

## Usage

```ts
import { aggregateCalls } from "@volga-sh/evm-ghostcall";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const results = await aggregateCalls(client, [
	{
		// WETH9 on Ethereum mainnet: totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
	{
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0xdeadbeef",
		allowFailure: true,
	},
]);
```

## Signature

```ts
async function aggregateCalls(
	provider: EIP1193ProviderWithRequestFn,
	calls: readonly GhostcallAggregateCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]>;
```

## Parameters

### provider

```ts
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};
```

Provider used to send the outer `eth_call`.

### calls

```ts
type GhostcallAggregateCall = {
	to: Hex;
	data: Hex;
	allowFailure?: boolean;
};
```

Ordered subcalls to execute.

`allowFailure` is SDK-side policy. It is not encoded into the ghostcall wire format. If a subcall fails and `allowFailure` is not `true`, the SDK throws `GhostcallSubcallError`.

### options

```ts
type GhostcallAggregateOptions = {
	maxInitcodeBytes?: number;
	ethCall?: {
		from?: Hex;
		gas?: HexQuantity;
		blockTag?: string | number | bigint;
	};
};
```

`maxInitcodeBytes` defaults to Ethereum's EIP-3860 limit of `49,152` bytes. `ethCall` values are forwarded to the outer RPC request.

## Returns

```ts
Promise<GhostcallResult[]>
```

Raw entries in the same order as the input calls.

```ts
type GhostcallResult =
	| { success: true; returnData: Hex }
	| { success: false; returnData: Hex };
```

## Throws

- `TypeError` when inputs or the provider response are not valid hex.
- `RangeError` when encoded call data or full CREATE initcode exceeds configured limits.
- `GhostcallSubcallError` when a subcall fails without `allowFailure: true`.
- `Error` when the response entry count does not match the request call count.

Provider and transport errors bubble from `provider.request()`.

## Notes

- The request is sent as `eth_call` with `{ data }` and no `to`.
- `blockTag` accepts named tags, hex quantities, decimal strings, numbers, or bigints. Decimal inputs are normalized to hex quantities.
- Use [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) when you want decoded values directly.
