---
title: GhostcallSubcallError
description: Identify the contract call that caused a batch to throw.
---

`GhostcallSubcallError` identifies the call that made a batch throw:

- `aggregateCalls()` throws it when a call fails, unless that call sets
  `allowFailure: true`.
- `aggregateDecodedCalls()` throws it when a call fails or its result cannot be
  decoded.

```ts twoslash
import { aggregateCalls, GhostcallSubcallError } from "@volga-sh/evm-ghostcall";

try {
	await aggregateCalls(client, [
		{
			to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
			data: "0xdeadbeef",
		},
	]);
} catch (error) {
	if (!(error instanceof GhostcallSubcallError)) throw error;
	console.log(error.index, error.call, error.returnData);
}
```

The error extends `Error` with these properties:

| Property | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Zero-based position of the call. |
| `call` | `GhostcallCall` | The raw entry that ran. For ABI calls, this is the target and encoded calldata. |
| `returnData` | `Hex` | What the call returned: its revert data if it failed, or the result that could not be decoded. |
| `cause` | `unknown` | The decoder's error. Set only when the result could not be decoded. |

## Decoding failures

A call can succeed but return data that cannot be decoded. For example, a call
to an address without code succeeds and returns `0x`, which is not a valid
`uint256`:

```ts twoslash
import { aggregateDecodedCalls, GhostcallSubcallError } from "@volga-sh/evm-ghostcall";
import { erc20Abi } from "viem";

const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const codeless = "0x000000000000000000000000000000000000dEaD";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";

try {
	await aggregateDecodedCalls(client, [
		{ to: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
		{ to: codeless, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
	]);
} catch (error) {
	if (!(error instanceof GhostcallSubcallError)) throw error;
	// 1, the codeless address, and ox's ZeroDataError
	console.log(error.index, error.call.to, error.cause);
}
```

Provider, transport, and encoding errors pass through unchanged.
