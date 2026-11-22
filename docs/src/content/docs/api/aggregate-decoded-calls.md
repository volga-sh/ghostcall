---
title: aggregateDecodedCalls
description: Describe ABI calls once and receive typed decoded results.
---

`aggregateDecodedCalls()` sends one `eth_call` and returns one decoded value for
each input call. Results keep the same order as the calls. If a call fails or
its result cannot be decoded, `aggregateDecodedCalls()` throws
`GhostcallSubcallError` for the first such call, unless its entry
[allows failure](#allowing-failures).

## ABI calls

Declare each ABI, function name, and argument list once. ghostcall uses ox to
resolve that function, encode its arguments, and decode its result.

```ts twoslash
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { erc20Abi } from "viem";

const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";

const results = await aggregateDecodedCalls(client, [
	{ to: token, abi: erc20Abi, functionName: "totalSupply" },
	{ to: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
	{ to: token, abi: erc20Abi, functionName: "decimals" },
]);
```

Function names and arguments are checked against the ABI, so editors suggest
the ABI's function names:

```ts twoslash
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { erc20Abi } from "viem";
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
// ---cut---
await aggregateDecodedCalls(client, [
	{ to: token, abi: erc20Abi, functionName: "totalSupply" },
	//                                          ^|
]);
```

`args` is required when the chosen function has inputs; zero-input functions
may omit it or use `args: []`. No return-type annotations or casts are needed.

Use literal JSON ABIs with `as const`, viem's `parseAbi`, or ox's `Abi.from` to
retain type inference. A broadly typed ABI loaded at runtime produces `unknown`
results and is validated during encoding.

Overloaded functions are resolved using the supplied arguments. Encoding and
decoding use the same resolved function. If ox reports ambiguous overloads,
pass an ABI containing the specific overload you intend to call. Only functions
are candidates: an event or error that shares the name is ignored. Arguments
that match no overload throw before the request is sent.

One output becomes a scalar; multiple outputs form an ordered tuple. A function
with no outputs returns `undefined`. These are ox's decoding conventions.
ABI-decoded addresses are checksummed, including addresses inside tuples and
arrays.

## Raw calls with custom decoders

Already-encoded calldata remains supported. Supply `data` and `decodeResult`
for those entries. Raw and ABI-described entries can share a batch:

```ts twoslash
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { erc20Abi } from "viem";
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const customContract = "0x28C6c06298d514Db089934071355E5743bf21d60";
// ---cut---
const results = await aggregateDecodedCalls(client, [
	{ to: token, abi: erc20Abi, functionName: "totalSupply" },
	{
		to: customContract,
		data: "0x12345678",
		decodeResult: (returnData) => BigInt(returnData),
	},
]);
```

A custom decoder receives `(returnData, index)`: the successful call's return
data and its zero-based position. Its return type determines that
position's result type. If the decoder throws, `aggregateDecodedCalls()` throws
a `GhostcallSubcallError` with `kind: "decode"` and the decoder's error as
`cause`, unless the entry [allows failure](#allowing-failures).

Each entry uses either ABI fields or raw calldata with a decoder. TypeScript
rejects entries mixing these fields. Use
[`aggregateCalls()`](/api/aggregate-calls/) for raw `{ to, data }` calls without
decoding.

## Allowing failures

Set `allowFailure: true` on an entry whose call may fail, such as a read across
tokens that may not implement the standard interface. That position then holds
a [`GhostcallDecodedResult`](/api/types/) instead of the bare value. A failure
carries the [`GhostcallSubcallError`](/api/subcall-error/) that the entry would
otherwise throw:

```ts twoslash
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { erc20Abi } from "viem";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const mkr = "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2";

const [usdcSymbol, mkrSymbol] = await aggregateDecodedCalls(client, [
	{ to: usdc, abi: erc20Abi, functionName: "symbol" },
	// MKR returns its symbol as bytes32, which does not decode as a string.
	{ to: mkr, abi: erc20Abi, functionName: "symbol", allowFailure: true },
]);

if (mkrSymbol.success) {
	console.log(mkrSymbol.result);
} else if (mkrSymbol.error.kind === "decode") {
	// The raw bytes32 the string decoder rejected.
	console.log(mkrSymbol.error.returnData);
} else {
	throw mkrSymbol.error;
}
```

A result with `success: true` carries the decoded `result`. One with
`success: false` carries `error`, whose `kind` says why:

- `"call"`: the call failed. `error.returnData` is its revert data, and the
  decoder never ran.
- `"decode"`: the call succeeded, but its decoder threw on `error.returnData`.
  `error.cause` is the decoder's error. A call to an address without code
  succeeds with `0x`, which an ABI decoder rejects for any function with
  outputs.

The flag changes only its own position. Entries without it still return the
bare value, and the first of their errors throws. A flag typed as `boolean`
rather than `true` leaves the choice to runtime, so its position has type
`T | GhostcallDecodedResult<T>`. To declare failure-tolerant entries ahead of
the batch, see [Types](/api/types/#declaring-reusable-calls).

## Provider and options

The provider and [options](/api/types/) match
[`aggregateCalls()`](/api/aggregate-calls/#block-sender-and-gas). Subcalls use
zero-value `CALL`, so non-view functions may change simulated state for later
calls in the batch.

## Errors

- ABI resolution and encoding errors, including ox's, are thrown before the RPC
  request.
- Invalid addresses, calldata, or provider responses throw `TypeError`.
- Requests exceeding a protocol or configured size limit throw `RangeError`.
- A failed call throws [`GhostcallSubcallError`](/api/subcall-error/) with
  `kind: "call"` and its revert data.
- A result that cannot be decoded throws `GhostcallSubcallError` with
  `kind: "decode"` and the decoder's error as `cause`. For example, a call to
  an address without code returns `0x`, which is not a valid `uint256`.
- An entry that sets `allowFailure: true` returns either error in its result
  instead of throwing it.
- A response with a different entry count throws `Error`.

Provider and transport errors pass through unchanged.
