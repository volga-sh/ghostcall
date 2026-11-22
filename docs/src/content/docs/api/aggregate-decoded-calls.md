---
title: aggregateDecodedCalls
description: Describe ABI calls once and receive typed decoded results.
---

`aggregateDecodedCalls()` sends one `eth_call` and returns one decoded value for
each input call. Results keep the same order as the calls. Every call must
succeed; a failed call throws `GhostcallSubcallError`.

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

## Calls built from a list

To call one function for every item in a list, map the list into calls and mark
each returned object with `satisfies GhostcallAbiCall<typeof abi>`:

```ts twoslash
import {
    aggregateDecodedCalls,
    type GhostcallAbiCall,
    type Hex,
} from "@volga-sh/evm-ghostcall";
import { erc20Abi } from "viem";

const tokens: Hex[] = [
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
];
const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";

const calls = tokens.map((token) => ({
    to: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
}) satisfies GhostcallAbiCall<typeof erc20Abi>);

const balances = await aggregateDecodedCalls(client, calls);
```

`balances` is a `bigint[]`, not a tuple: `.map` returns an array, so TypeScript
does not track individual positions. Results still follow call order, so
`balances[i]` is `owner`'s balance of `tokens[i]`. Spread mapped calls into a
literal list to mix them with fixed calls; the fixed positions keep their own
types.

`satisfies` checks each call against the ABI inside the callback, so editors
suggest function names there and report a misspelled name or wrong argument
where it is written. `as const` on the returned object also infers `bigint[]`,
but checks the calls only when the batch reaches `aggregateDecodedCalls()`.

Without either, the batch fails to compile. TypeScript widens `functionName` in
an object returned from `.map` to `string`, because `aggregateDecodedCalls()`
cannot name the functions of an ABI it has not seen yet. Annotating the
callback's return type as `GhostcallAbiCall<typeof erc20Abi>` compiles, but that
type covers every function in the ABI, so each result widens to the union of
all their result types.

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
position's result type. Decoder errors pass through unchanged.

Each entry uses either ABI fields or raw calldata with a decoder. TypeScript
rejects entries mixing these fields, and neither form accepts `allowFailure`.
Use [`aggregateCalls()`](/api/aggregate-calls/) for raw `{ to, data }` calls and
optional failures.

## Provider and options

The provider and [options](/api/types/) match
[`aggregateCalls()`](/api/aggregate-calls/#block-sender-and-gas). Subcalls use
zero-value `CALL`, so non-view functions may change simulated state for later
calls in the batch.

## Errors

- ABI resolution and encoding errors occur before RPC. ox errors pass through.
- Invalid addresses, calldata, or provider responses throw `TypeError`.
- Requests exceeding a protocol or configured size limit throw `RangeError`.
- Failed calls throw [`GhostcallSubcallError`](/api/subcall-error/), including
  their raw revert data.
- A response with a different entry count throws `Error`.

Provider, transport, and result-decoding errors pass through unchanged. For ABI
calls, a subcall error's `call` field contains the prepared raw calldata.
