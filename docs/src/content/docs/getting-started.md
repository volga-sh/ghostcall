---
title: Getting Started
description: Install ghostcall and send a CREATE-style eth_call batch with the TypeScript SDK.
---

Install the package from npm:

```sh
npm install @volga-sh/evm-ghostcall
```

## Basic batch

The SDK accepts an EIP-1193-style provider and raw call entries. ABI libraries such as viem or ox remain caller-owned.

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
	"function allowance(address owner, address spender) view returns (uint256)",
]);

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
const spender = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

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

## Raw request path

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

const response = await provider.request({
	method: "eth_call",
	params: [{ data }, "latest"],
});

const results = decodeResults(response as `0x${string}`);
```

The `eth_call` object intentionally omits `to`. That is what makes the EVM execute the supplied data as CREATE initcode.

Some RPC providers do not support this CREATE-style `eth_call` pattern consistently, so verify the exact endpoint you plan to use.

## Failure policy

Subcall failures are returned by the protocol as result entries. `aggregateCalls()` rejects failed entries by default. Set `allowFailure: true` on a call when you want that failed entry returned to the caller instead.

`aggregateDecodedCalls()` is the strict decoded helper: every call must provide `decodeResult`, and `allowFailure` cannot be true. Batch order also matters for gas usage because each subcall receives all remaining gas when it runs.
