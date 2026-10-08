---
title: Getting Started
description: Install ghostcall and send a first batch of contract reads.
---

This guide reads two ERC-20 values in one RPC request.

## 1. Install the packages

```sh
npm install @volga-sh/evm-ghostcall viem
```

ghostcall accepts any provider with an
[EIP‑1193](https://eips.ethereum.org/EIPS/eip-1193) `request` method. This guide
uses viem for the provider and ABI; ghostcall itself uses ox to encode arguments
and decode results.

## 2. Create a client

```ts twoslash
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });
```

## 3. Send the batch

Each entry declares its target, ABI, function name, and arguments once. The same
function definition encodes the call and decodes its result.

```ts twoslash
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });
// ---cut---
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
//     ^?
//              ^?
	{ to: usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
	{ to: usdc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] },
]);
```

Function names and argument types are checked against the ABI. Use a literal
ABI (`as const`), viem's `parseAbi`, or ox's `Abi.from` to preserve inference;
ABIs loaded at runtime still work, but their results have type `unknown`.

If either call fails, `aggregateDecodedCalls()` throws a
[`GhostcallSubcallError`](/api/subcall-error/).

## Next

- [`aggregateCalls()`](/api/aggregate-calls/) lets selected calls fail and sets
  the block, sender, or gas.
- [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) covers overloads and
  custom decoders for raw calldata.
- [`encodeCalls()`](/api/encode-calls/) builds the request when the application
  sends the RPC call itself.
