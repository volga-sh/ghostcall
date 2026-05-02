---
title: decodeResults
description: Decode the packed result blob returned by ghostcall.
---

Parses the binary response returned by the ghostcall initcode into raw result entries.

Use this with [`encodeCalls()`](/api/encode-calls/) when you send the RPC request directly.

## Usage

```ts
import { decodeResults } from "@volga-sh/evm-ghostcall";

const results = decodeResults("0x8002cafe0004deadbeef");

console.log(results);
// [
//   { success: true, returnData: "0xcafe" },
//   { success: false, returnData: "0xdeadbeef" },
// ]
```

## Signature

```ts
function decodeResults(data: Hex): GhostcallResult[];
```

## Parameters

### data

```ts
type Hex = `0x${string}`;
```

Raw bytes returned by ghostcall, typically the direct result of a CREATE-style `eth_call`.

Each result entry is encoded as:

```text
2 bytes packed header
N bytes returndata
```

The header layout is:

```text
bit 15    success flag
bits 0-14 returndata length
```

## Returns

```ts
GhostcallResult[]
```

Ordered decoded entries.

```ts
type GhostcallResult =
	| { success: true; returnData: Hex }
	| { success: false; returnData: Hex };
```

`decodeResults("0x")` returns an empty array.

## Throws

- `TypeError` when `data` is not valid even-length `0x` hex.
- `TypeError` when a result header is truncated.
- `TypeError` when a result body is shorter than the length declared in its header.

## Notes

- Failed subcalls are ordinary result entries with `success: false`.
- ABI decoding is caller-owned. Pass `returnData` to viem, ox, ethers, or your own decoder.
- `decodeResults()` only parses the response shape; it does not know how many calls were originally requested.
