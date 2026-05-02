---
title: aggregateDecodedCalls
description: Send a strict ghostcall batch and decode each successful result entry.
---

Sends one CREATE-style `eth_call` and returns decoded values in the same order as the input calls.

Use this for the common app path: every subcall is expected to succeed, and each call provides a `decodeResult` callback. The SDK builds the request through `encodeCalls()`, so input validation happens before the RPC request is sent.

## Usage

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import {
	createPublicClient,
	decodeFunctionResult,
	encodeFunctionData,
	http,
	parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

const erc20Abi = parseAbi([
	"function balanceOf(address account) view returns (uint256)",
	"function totalSupply() view returns (uint256)",
]);

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";

const [balance, totalSupply] = await aggregateDecodedCalls(client, [
	{
		to: token,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "balanceOf",
			args: [owner],
		}),
		decodeResult: (returnData) =>
			decodeFunctionResult({
				abi: erc20Abi,
				functionName: "balanceOf",
				data: returnData,
			}),
	},
	{
		to: token,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "totalSupply",
		}),
		decodeResult: (returnData) =>
			decodeFunctionResult({
				abi: erc20Abi,
				functionName: "totalSupply",
				data: returnData,
			}),
	},
]);
```

## Signature

```ts
async function aggregateDecodedCalls<
	const TCalls extends readonly GhostcallDecodedCall<unknown>[],
>(
	provider: EIP1193ProviderWithRequestFn,
	calls: TCalls,
	options?: GhostcallAggregateOptions,
): Promise<GhostcallDecodedResults<TCalls>>;
```

## Parameters

### provider

```ts
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};
```

Provider used to send the outer `eth_call`. A viem public client works because it exposes a compatible `request` method.

### calls

```ts
type GhostcallDecodedCall<TResult = unknown> = {
	to: Hex;
	data: Hex;
	decodeResult: GhostcallResultDecoder<TResult>;
};

type GhostcallResultDecoder<TResult> = (
	returnData: Hex,
	entry: GhostcallSuccessResult,
	index: number,
) => TResult;
```

Ordered subcalls to execute. Each call must include raw contract calldata and a decoder for successful return data.

`aggregateDecodedCalls()` is strict: `allowFailure` is not part of this input type.

### options

```ts
type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	ethCall?: {
		from?: Hex;
		gas?: HexQuantity;
		blockTag?: string | number | bigint;
	};
};
```

Optional CREATE initcode limit and outer `eth_call` controls. `blockTag` defaults to `"latest"`.

## Returns

```ts
Promise<GhostcallDecodedResults<TCalls>>
```

A tuple of decoded values inferred from each call's `decodeResult` callback.

## Throws

- `TypeError` when inputs or the provider response are not valid hex.
- `RangeError` when encoded call data or full CREATE initcode exceeds configured limits.
- `GhostcallSubcallError` when any subcall fails.
- `Error` when the response entry count does not match the request call count.

## Notes

- The SDK sends `{ data }` without a `to` field so the RPC executes ghostcall as CREATE initcode.
- Subcalls execute in order with ordinary `CALL`, not `STATICCALL`.
- Use [`aggregateCalls()`](/api/aggregate-calls/) if you need raw failed entries.
