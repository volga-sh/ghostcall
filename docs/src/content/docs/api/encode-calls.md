---
title: encodeCalls
description: Encode ghostcall entries into the full CREATE-style eth_call payload.
---

Builds the complete request `data` field for a CREATE-style `eth_call`.

Use this when you want to own the RPC request yourself.

## Usage

```ts
import { encodeCalls } from "@volga-sh/evm-ghostcall";

const data = encodeCalls([
	{
		// WETH9 on Ethereum mainnet: totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
]);

const rpcResponse = await fetch("https://ethereum-rpc.publicnode.com", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "eth_call",
		params: [{ data }, "latest"],
	}),
});

const body = (await rpcResponse.json()) as {
	error?: { message?: string };
	result?: `0x${string}`;
};

if (!body.result) {
	throw new Error(body.error?.message ?? "eth_call returned no result");
}

const response = body.result;
```

## Signature

```ts
function encodeCalls(
	calls: readonly GhostcallCall[],
	options?: GhostcallEncodeOptions,
): Hex;
```

## Parameters

### calls

```ts
type GhostcallCall = {
	to: Hex;
	data: Hex;
};
```

Ordered subcalls to encode. `to` must be a 20-byte address and `data` must be even-length `0x` hex.

Each entry is encoded as:

```text
2 bytes calldata length
20 bytes target address
N bytes calldata
```

### options

```ts
type GhostcallEncodeOptions = {
	maxInitcodeBytes?: number;
};
```

Maximum allowed size of the full CREATE initcode payload in bytes. Defaults to `49,152`.

## Returns

```ts
Hex
```

Full CREATE payload:

```text
<bundled ghostcall initcode><encoded call entries>
```

Pass the returned value as the `data` field of `eth_call` without a `to` address.

## Throws

- `TypeError` when `to` or `data` is not valid hex, or when `to` is not exactly 20 bytes.
- `TypeError` when `options.maxInitcodeBytes` is not a non-negative safe integer.
- `RangeError` when a call's `data` exceeds `65,535` bytes.
- `RangeError` when the bundled initcode plus encoded calls exceeds `maxInitcodeBytes`.

## Notes

- An empty call list is valid and encodes just the bundled ghostcall initcode.
- The input format has no count field. The Yul program advances through appended entries until it reaches the end of the initcode payload.
- Use [`decodeResults()`](/api/decode-results/) to parse the returned blob.
