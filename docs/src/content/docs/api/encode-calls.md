---
title: encodeCalls
description: Build the data for a ghostcall eth_call request.
---

`encodeCalls()` returns the ghostcall program, then the encoded calls. Send the
result as the `data` of an `eth_call` without a `to` address. Then decode the
response with [`decodeResults()`](/api/decode-results/). Use these two functions
if your application sends the RPC request.

## Usage

```ts twoslash
import { decodeResults, encodeCalls, type Hex } from "@volga-sh/evm-ghostcall";

const data = encodeCalls([
	{
		// WETH totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
]);

const response = await fetch("https://ethereum-rpc.publicnode.com", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "eth_call",
		params: [{ data }, "latest"],
	}),
});
const body = (await response.json()) as {
	result?: Hex;
	error?: { message?: string };
};
if (!body.result) throw new Error(body.error?.message ?? "eth_call failed");

const results = decodeResults(body.result);
```

## Signature

```ts twoslash
import { encodeCalls } from "@volga-sh/evm-ghostcall";
//       ^?
```

For each type, refer to [Types](/api/types/). For the byte layout, refer to
[Protocol](/protocol/#request-bytes).

- Each `to` must be a 20-byte address. Each `data` must be hex with an even
  length and a `0x` prefix. The maximum size of `data` is `65,535` bytes.
  `encodeCalls()` does not use `allowFailure`.
- `maxInitcodeBytes` sets the maximum size of the full request. The default is
  `49,152`.
- `calls` must contain one or more calls.

## Throws

- `TypeError` for an incorrect address or hex value.
- `RangeError` if `calls` is empty.
- `RangeError` if one call has more than `65,535` bytes of calldata, or if the
  full request is larger than `maxInitcodeBytes`.
