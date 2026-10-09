---
title: encodeCalls
description: Build the data for a ghostcall eth_call request.
---

`encodeCalls()` returns the ghostcall program and the encoded calls after it.
Send the result as the `data` of an `eth_call` without a `to` address.
Parse the response with [`decodeResults()`](/api/decode-results/). Use these
functions when the application sends the RPC request.

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

Refer to [Types](/api/types/) for each type. Refer to
[Protocol](/protocol/#request-bytes) for the byte layout.

- Each `to` must be a 20-byte address. Each `data` must be even-length,
  `0x`-prefixed hex of at most `65,535` bytes. The encoder does not use
  `allowFailure`.
- `maxInitcodeBytes` gives the size limit for the full request. Its default
  value is `49,152`.
- An empty call list gives `0x5f80f3`. This three-byte program returns an empty
  response.

## Throws

- `TypeError` for an invalid address or hex value.
- `RangeError` when one call contains more than `65,535` bytes of calldata.
  The function also throws this error when the full request is larger than
  `maxInitcodeBytes`.
