---
title: API Reference
description: Public TypeScript SDK functions, errors, and types exported by ghostcall.
---

The SDK exposes a small protocol-first surface. Start with `aggregateDecodedCalls()` for strict decoded reads, then drop lower only when you need raw result entries or direct RPC control.

```ts
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
} from "@volga-sh/evm-ghostcall";
```

## Functions

- [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) sends a strict batch and returns decoded values.
- [`aggregateCalls()`](/api/aggregate-calls/) sends a batch and returns raw `{ success, returnData }` entries.
- [`encodeCalls()`](/api/encode-calls/) encodes call entries into the full CREATE-style `eth_call` payload.
- [`decodeResults()`](/api/decode-results/) decodes the packed result blob returned by ghostcall.

## Error

- [`GhostcallSubcallError`](/api/subcall-error/) is thrown when a strict SDK batch encounters a failed subcall.

## Types

The reference pages inline the most relevant input and output types. See [Types](/api/types/) for the compact shared type catalog.
