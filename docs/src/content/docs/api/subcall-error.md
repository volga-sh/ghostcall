---
title: GhostcallSubcallError
description: Inspect a contract call that caused a batch to throw.
---

`aggregateDecodedCalls()` throws `GhostcallSubcallError` for any failed call.
`aggregateCalls()` throws it unless that entry sets `allowFailure: true`.

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

The error extends `Error` with three readonly properties:

| Property | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Zero-based position of the failed call. |
| `call` | `GhostcallCall` | The executed raw entry. ABI calls expose the target and prepared calldata. |
| `returnData` | `Hex` | The raw revert data, or `0x` when the call reverted without data. |

The outer request completed, but an inner call failed. Provider, transport,
encoding, and decoding errors pass through with their original types.
