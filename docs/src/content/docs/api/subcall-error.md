---
title: GhostcallSubcallError
description: Read data about a contract call that caused a batch error.
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

The error extends `Error` with three properties. These properties are
`readonly`:

| Property | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Zero-based position of the failed call. |
| `call` | `GhostcallCall` | The raw entry that ran. ABI entries contain the target and the calldata that the SDK prepared. |
| `returnData` | `Hex` | The raw revert data. The value is `0x` if the call reverted without data. |

The outer request completed. An inner call failed. Provider, transport,
encoding, and decoding errors keep the same types.
