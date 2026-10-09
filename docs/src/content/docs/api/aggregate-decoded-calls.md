---
title: aggregateDecodedCalls
description: Describe ABI calls once and receive typed decoded results.
---

`aggregateDecodedCalls()` sends one `eth_call` and returns one decoded value for
each call. The results are in the call order. If a call has `success: false`,
the function throws `GhostcallSubcallError`.

## ABI calls

For each call, give the ABI, the function name, and the argument list one time.
ghostcall uses ox to find the function, encode its arguments, and decode its
result.

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

TypeScript does a check of the function names and the arguments against the
ABI. Thus editors show the function names of the ABI:

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

If the function has inputs, `args` is necessary. For a function with no inputs,
you do not have to give `args`, or you can use `args: []`. Return type
annotations and casts are not necessary.

To keep the type inference, use literal JSON ABIs with `as const`, the viem
`parseAbi` function, or the ox `Abi.from` function. If you load an ABI at runtime
with a general type, the results have the type `unknown`. The SDK does a check
of this ABI when it encodes the calls.

The SDK uses the arguments to find the correct overloaded function. The encoder
and the decoder use the same function. If ox finds more than one applicable
overload, give an ABI with only the necessary overload.

A function with one output gives a scalar value. A function with more than one
output gives an ordered tuple. A function with no outputs gives `undefined`.
These rules come from the ox decoder. The decoder returns checksummed
addresses, also in tuples and arrays.

## Raw calls with custom decoders

You can also use calldata that is already encoded. For these entries, give
`data` and `decodeResult`. Raw entries and ABI entries can be in the same batch:

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

A custom decoder gets `(returnData, index)`: the return data of the call and
the zero-based position of the call. The return type of the decoder sets the
result type for that position. The function does not change decoder errors.

Each entry uses ABI fields or raw calldata with a decoder, but not both.
TypeScript does not accept an entry with the two types of fields. The two forms
do not accept `allowFailure`. For raw `{ to, data }` calls and calls that can
revert, use [`aggregateCalls()`](/api/aggregate-calls/).

## Provider and options

The provider and the [options](/api/types/) are the same as for
[`aggregateCalls()`](/api/aggregate-calls/#block-sender-and-gas). The calls use
`CALL` with zero value. Thus a function that is not a view function can change
the state for the later calls in the batch.

For an empty list of calls, the function returns `[]`. It does not send an RPC
request.

## Errors

- ABI errors and encoding errors occur before the RPC request. The function
  does not change ox errors.
- Incorrect addresses, calldata, or provider responses throw `TypeError`.
- A request that is larger than a protocol limit or a limit that you set throws
  `RangeError`.
- A call with `success: false` throws
  [`GhostcallSubcallError`](/api/subcall-error/). The error contains the raw
  revert data.
- A response with a different number of results throws `Error`.

The function does not change provider errors, transport errors, or decoder
errors. For ABI calls, the `call` field of a subcall error contains the prepared
raw calldata.
