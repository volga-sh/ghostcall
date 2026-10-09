---
title: decodeResults
description: Parse the raw response from ghostcall.
---

`decodeResults()` parses the hex response from an `eth_call` that uses
[`encodeCalls()`](/api/encode-calls/). It returns one
[`GhostcallResult`](/api/types/) per call. Results have the same order as the
calls. Refer to [Protocol](/protocol/#response-bytes) for the byte layout.

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

`decodeResults("0x")` returns `[]`. The function returns failed entries without
an error. It does not decode `returnData` with an ABI. It does not use the
number of calls in the request.

## Throws

- `TypeError` when `data` is not even-length hex with a `0x` prefix.
- `TypeError` when the response ends before a complete header or result body.
