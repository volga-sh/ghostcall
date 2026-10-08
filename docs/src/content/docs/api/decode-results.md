---
title: decodeResults
description: Parse the raw response returned by ghostcall.
---

`decodeResults()` parses the hex returned by an `eth_call` built with
[`encodeCalls()`](/api/encode-calls/) into one
[`GhostcallResult`](/api/types/) per call, in call order. See
[Protocol](/protocol/#response-bytes) for the byte layout.

## Usage

```ts
import { decodeResults } from "@volga-sh/evm-ghostcall";

decodeResults("0x8002cafe0004deadbeef");
// [
//   { success: true, returnData: "0xcafe" },
//   { success: false, returnData: "0xdeadbeef" },
// ]
```

## Signature

```ts
function decodeResults(data: Hex): GhostcallResult[];
```

`decodeResults("0x")` returns `[]`. The function applies no failure policy,
does not ABI-decode `returnData`, and does not know how many calls were sent.

## Throws

- `TypeError` when `data` is not even-length hex with a `0x` prefix.
- `TypeError` when the response ends before a complete header or result body.
