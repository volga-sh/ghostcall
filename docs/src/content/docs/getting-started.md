---
title: Getting Started
description: Install ghostcall and send a CREATE-style eth_call batch with the TypeScript SDK.
---

Get from install to a real batch in a few lines. The recommended entrypoint is `aggregateDecodedCalls()` because it performs the CREATE-style `eth_call`, checks strict failures, and returns decoded values in request order.

## 1. Install

```sh
npm install @volga-sh/evm-ghostcall
```

The examples below also use viem. Install it with `npm install viem` if your app does not already provide a client and ABI helpers.

## 2. Set up a provider

Ghostcall accepts any provider with an EIP-1193-style `request` method. This example uses viem for the provider plus ABI encoding and decoding:

```ts
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});
```

Pass your authenticated RPC URL to `http()` in production.

## 3. Batch reads

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const erc20Abi = parseAbi([
	"function balanceOf(address account) view returns (uint256)",
	"function allowance(address owner, address spender) view returns (uint256)",
]);

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
const spender = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const [balance, allowance] = await aggregateDecodedCalls(
	client,
	[
		{
			to: usdc,
			data: encodeFunctionData({
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [owner],
			}),
			decodeResult: (data) =>
				decodeFunctionResult({
					abi: erc20Abi,
					functionName: "balanceOf",
					data,
				}),
		},
		{
			to: usdc,
			data: encodeFunctionData({
				abi: erc20Abi,
				functionName: "allowance",
				args: [owner, spender],
			}),
			decodeResult: (data) =>
				decodeFunctionResult({
					abi: erc20Abi,
					functionName: "allowance",
					data,
				}),
		},
	],
);

console.log({ balance, allowance });
```

Each `data` value is normal contract calldata. Each `decodeResult` callback receives successful raw return data and can use whichever ABI library your app already owns.

## When to use another helper

Use `aggregateCalls()` if you need raw result entries or want selected subcalls to be allowed to fail:

```ts
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const results = await aggregateCalls(client, [
	{
		to: usdc,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "balanceOf",
			args: [owner],
		}),
	},
	{
		to: usdc,
		data: "0xdeadbeef",
		allowFailure: true,
	},
]);
```

If you want to own the RPC call directly, use `encodeCalls()` and `decodeResults()`:

```ts
import { decodeResults, encodeCalls } from "@volga-sh/evm-ghostcall";

const data = encodeCalls([
	{
		// WETH9 on Ethereum mainnet: totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
]);

const response = await client.request({
	method: "eth_call",
	params: [{ data }, "latest"],
});

const results = decodeResults(response as `0x${string}`);
```

The `eth_call` object intentionally omits `to`. That is what makes the EVM execute the supplied data as CREATE initcode.

## Failure policy

The protocol returns subcall failures as result entries with `success: false`. The SDK applies the higher-level policy:

- `aggregateDecodedCalls()` is always strict and rejects any failed subcall.
- `aggregateCalls()` rejects failed subcalls unless that call sets `allowFailure: true`.
- Raw `encodeCalls()` plus `decodeResults()` leaves failure policy entirely to you.

Some RPC providers do not support CREATE-style `eth_call` consistently, so verify the exact endpoint you plan to use.
