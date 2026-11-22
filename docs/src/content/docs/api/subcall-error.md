---
title: GhostcallSubcallError
description: Identify the contract call that caused a batch to throw.
---

`aggregateCalls()` throws `GhostcallSubcallError` when a call fails, unless that
entry sets `allowFailure: true`. `aggregateDecodedCalls()` throws it when any
call fails, and when a call succeeds but its decoder throws.

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

The error extends `Error` with three readonly properties, plus `cause` for
decoding failures:

| Property | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Zero-based position of the call. |
| `call` | `GhostcallCall` | The executed raw entry. ABI calls expose the target and prepared calldata. |
| `returnData` | `Hex` | A failed call's revert data, or `0x` when it reverted without data. For a decoding failure, the successful return data the decoder rejected. |
| `cause` | `unknown` | Set only for decoding failures: the value the ABI decoder or custom `decodeResult` threw. `undefined` when the call failed. |

## Decoding failures

A call can succeed and still return data its decoder rejects. A call to an
address without code succeeds with `0x`, which ox cannot decode as a `uint256`:

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
	// 1, the codeless target, and ox's ZeroDataError
	console.log(error.index, error.call.to, error.cause);
}
```

The message tells the cases apart: `ghostcall subcall 1 failed` for a failed
call, `ghostcall subcall 1 result could not be decoded` for a decoding failure.

In both cases the outer request completed. Provider, transport, and encoding
errors pass through with their original types.
