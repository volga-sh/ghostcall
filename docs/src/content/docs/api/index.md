---
title: API Reference
description: Choose a ghostcall function based on the required result.
---

ghostcall exports four functions, one error class, and their
[types](/api/types/).

| Goal | Function |
| --- | --- |
| Decode every result; any failed call throws | [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) |
| Inspect success flags and return data; let selected calls fail | [`aggregateCalls()`](/api/aggregate-calls/) |
| Build request data for an `eth_call` sent by the application | [`encodeCalls()`](/api/encode-calls/) |
| Parse the response to that `eth_call` | [`decodeResults()`](/api/decode-results/) |

[`GhostcallSubcallError`](/api/subcall-error/) identifies which call failed.

```ts
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
} from "@volga-sh/evm-ghostcall";
```

Read [Limits](/limits/) before building unusually large batches.
