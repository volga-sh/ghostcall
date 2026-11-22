---
title: GhostcallSubcallError
description: Identify the contract call that caused a batch to throw, and why.
---

`GhostcallSubcallError` identifies the call that made a batch throw, and its
`kind` says why:

- `"call"`: the call failed. `aggregateCalls()` throws this unless the call
  sets `allowFailure: true`; `aggregateDecodedCalls()` always throws it.
- `"decode"`: the call succeeded, but its result could not be decoded. Only
  `aggregateDecodedCalls()` throws this.

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
	console.log(error.index, error.kind, error.returnData);
}
```

The error extends `Error` with these properties:

| Property | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Zero-based position of the call. |
| `call` | `GhostcallCall` | The raw entry that ran. For ABI calls, this is the target and encoded calldata. |
| `kind` | `"call" \| "decode"` | Whether the call failed or its result could not be decoded. |
| `returnData` | `Hex` | For `"call"`, the revert data. For `"decode"`, the result that could not be decoded. |
| `cause` | `unknown` | For `"decode"` only: the error the decoder threw. |

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
	if (error.kind === "decode") {
		// 1, the codeless address, and ox's ZeroDataError
		console.log(error.index, error.call.to, error.cause);
	}
}
```

Provider, transport, and encoding errors pass through unchanged.
