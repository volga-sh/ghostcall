---
title: decodeResults
description: Parse the raw response returned by ghostcall.
---

`decodeResults()` parses the hex returned by an `eth_call` built with
[`encodeCalls()`](/api/encode-calls/) into one
[`GhostcallResult`](/api/types/) per call, in call order. See
[Protocol](/protocol/#response-bytes) for the byte layout.

## Usage

```ts twoslash
import { decodeResults } from "@volga-sh/evm-ghostcall";

const results = decodeResults("0x8002cafe0004deadbeef");
//    ^?
// [
//   { success: true, returnData: "0xcafe" },
//   { success: false, returnData: "0xdeadbeef" },
// ]
```

## Signature

```ts twoslash
import type { GhostcallResult, Hex } from "@volga-sh/evm-ghostcall";
// ---cut---
declare function decodeResults(data: Hex): GhostcallResult[];
// ---cut-after---
// Fail the docs build if this signature drifts from the SDK.
import { decodeResults as exported } from "@volga-sh/evm-ghostcall";
exported satisfies typeof decodeResults;
decodeResults satisfies typeof exported;
```

`decodeResults("0x")` returns `[]`. The function applies no failure policy,
does not ABI-decode `returnData`, and does not know how many calls were sent.

## Throws

- `TypeError` when `data` is not even-length hex with a `0x` prefix.
- `TypeError` when the response ends before a complete header or result body.
