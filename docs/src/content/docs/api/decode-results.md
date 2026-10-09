---
title: decodeResults
description: Parse the raw response returned by ghostcall.
---

`decodeResults()` decodes the hex that an `eth_call` returns. It returns one
[`GhostcallResult`](/api/types/) for each call, in the call order. Make the
`eth_call` data with [`encodeCalls()`](/api/encode-calls/). For the byte layout,
refer to [Protocol](/protocol/#response-bytes).

## Usage

```ts twoslash
import { decodeResults } from "@volga-sh/evm-ghostcall";

const results = decodeResults("0x0005cafe0008deadbeef");
// [
//   { success: true, returnData: "0xcafe" },
//   { success: false, returnData: "0xdeadbeef" },
// ]
```

## Signature

```ts twoslash
import { decodeResults } from "@volga-sh/evm-ghostcall";
//       ^?
```

`decodeResults("0x")` returns `[]`. The function does not throw for a call with
`success: false`, and it does not ABI-decode `returnData`. It also does not know
the number of calls in the request.

## Throws

- `TypeError` if `data` is not hex with an even length and a `0x` prefix.
- `TypeError` if the response ends before a complete header or a complete
  result.
