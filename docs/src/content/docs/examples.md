---
title: Examples
description: Common ghostcall SDK usage patterns for decoded batches, raw result entries, and direct RPC ownership.
---

## Decoded ERC-20 reads

Use `aggregateDecodedCalls()` when every call should succeed and you want decoded values back.

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

## Allow one call to fail

Use `aggregateCalls()` when you need raw entries or want to tolerate a failed subcall.

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
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
	{
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0xdeadbeef",
		allowFailure: true,
	},
]);

for (const result of results) {
	if (result.success) {
		console.log("return data", result.returnData);
	} else {
		console.log("revert data", result.returnData);
	}
}
```

## Send the RPC request yourself

Use `encodeCalls()` and `decodeResults()` when you want direct control over transport, retries, or RPC payload construction.

```ts
import { decodeResults, encodeCalls } from "@volga-sh/evm-ghostcall";

const data = encodeCalls([
	{
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
]);

const rpcResponse = await fetch("https://ethereum-rpc.publicnode.com", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "eth_call",
		params: [{ data }, "latest"],
	}),
});

const body = (await rpcResponse.json()) as {
	error?: { message?: string };
	result?: `0x${string}`;
};

if (!body.result) {
	throw new Error(body.error?.message ?? "eth_call returned no result");
}

const results = decodeResults(body.result);
```

The call object omits `to`; the supplied `data` is executed as CREATE initcode.
