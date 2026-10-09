---
title: Getting Started
description: Install ghostcall and send a first batch of contract reads.
---

This guide reads two ERC-20 values in one RPC request.

## 1. Install the packages

```sh
npm install @volga-sh/evm-ghostcall viem
```

ghostcall accepts a provider with an [EIP‑1193](https://eips.ethereum.org/EIPS/eip-1193) `request` method.
This guide uses viem for the provider and ABI.
ghostcall uses ox to encode arguments and decode results.

## 2. Create a client

```ts twoslash
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });
```

## 3. Send the batch

Each entry contains its target, ABI, function name, and arguments.
The encoder and decoder use the same function definition.

```ts twoslash
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { parseAbi } from "viem";

const erc20Abi = parseAbi([
	"function balanceOf(address account) view returns (uint256)",
	"function allowance(address owner, address spender) view returns (uint256)",
]);
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
const spender = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const [balance, allowance] = await aggregateDecodedCalls(client, [
	{ to: usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
	{ to: usdc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] },
]);
```

The SDK does a check of function names and argument types against the ABI.
Use a literal ABI (`as const`), viem's `parseAbi`, or ox's `Abi.from` for type inference.
You can also load an ABI at runtime.
Results from an ABI that you load at runtime have type `unknown`.

If a call fails, `aggregateDecodedCalls()` throws a [`GhostcallSubcallError`](/api/subcall-error/).

## Next

- Use [`aggregateCalls()`](/api/aggregate-calls/) to let specified calls fail or set the block, sender, and gas.
- Read [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) for overloads and custom decoders for raw calldata.
- Use [`encodeCalls()`](/api/encode-calls/) to make a request that the application sends itself.
