---
title: encodeCalls
description: Build the data for a ghostcall eth_call request.
---

`encodeCalls()` returns the ghostcall program followed by the encoded calls.
Send it as the `data` of an `eth_call` without a `to` address, then parse the
response with [`decodeResults()`](/api/decode-results/). Use this pair when the
application sends the RPC request itself.

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

See [Types](/api/types/) for each type and [Protocol](/protocol/#request-bytes)
for the byte layout.

- Each `to` must be a 20-byte address. Each `data` must be even-length,
  `0x`-prefixed hex of at most `65,535` bytes. `allowFailure` is ignored.
- `maxInitcodeBytes` caps the complete request and defaults to `49,152`.
- An empty call list is valid and returns only the ghostcall program.

## Throws

- `TypeError` for an invalid address or hex value.
- `RangeError` when one call contains more than `65,535` bytes of calldata, or
  the complete request exceeds `maxInitcodeBytes`.
