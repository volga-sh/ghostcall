---
title: API Reference
description: Choose a ghostcall function based on the required result.
---

ghostcall exports four functions, one error class, their
[types](/api/types/), and the compiled program as `ghostcallInitcode`.

| Goal | Function |
| --- | --- |
| Decode every result; a failed or undecodable call throws unless allowed to fail | [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) |
| Inspect raw success flags and return data | [`aggregateCalls()`](/api/aggregate-calls/) |
| Build request data for an `eth_call` sent by the application | [`encodeCalls()`](/api/encode-calls/) |
| Parse the response to that `eth_call` | [`decodeResults()`](/api/decode-results/) |

[`GhostcallSubcallError`](/api/subcall-error/) identifies the call that failed
or could not be decoded.

Hover a name below to read its signature and description.

```ts twoslash
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
	ghostcallInitcode,
} from "@volga-sh/evm-ghostcall";
```

Read [Limits](/limits/) before building unusually large batches.
