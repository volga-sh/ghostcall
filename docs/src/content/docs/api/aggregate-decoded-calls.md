---
title: aggregateDecodedCalls
description: Supply ABI calls and get decoded results with inferred types.
---

`aggregateDecodedCalls()` sends one `eth_call` and returns one decoded value for
each input call. Results have the same order as the calls. A failed call throws
`GhostcallSubcallError`.

## ABI calls

Supply the ABI, function name, and arguments for each call. ghostcall uses ox
to select the function. ox encodes the arguments and decodes the result.

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

The SDK compares function names and arguments with the ABI. Editors suggest
function names from the ABI:

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

You must supply `args` if the function has inputs. If the function has no
inputs, you do not need `args`. You can also use `args: []`. You do not need
type annotations or type casts for the results.

Use literal JSON ABIs with `as const` to keep type inference. You can also use
`parseAbi` from viem or `Abi.from` from ox. An ABI with a general type gives
`unknown` results. The SDK does a check of this ABI when it encodes the calls.

ox uses the supplied arguments to select an overloaded function. Encoding and
decoding use the same function. If ox cannot select one overload, supply an ABI
that contains only the necessary overload.

ox decodes one output as a scalar. It decodes more than one output as a tuple
in output order. A function without outputs returns `undefined`. ox adds
checksums to decoded addresses. This includes addresses in tuples and arrays.

## Raw calls with custom decoders

You can use calldata that you have already encoded. Supply `data` and
`decodeResult` for these entries. One batch can contain raw entries and ABI
entries:

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

A custom decoder receives `(returnData, index)`. These arguments contain the
return data and the position of the call with `success: true`. The first position is
zero. The decoder return type sets the result type for that position. Decoder
errors do not change.

Each entry uses ABI fields or raw calldata with a decoder. TypeScript rejects
entries that mix these fields. You cannot use `allowFailure` in either form.
Use [`aggregateCalls()`](/api/aggregate-calls/) for raw `{ to, data }` calls if
some calls can fail.

## Provider and options

The provider and [options](/api/types/) are the same as for
[`aggregateCalls()`](/api/aggregate-calls/#block-sender-and-gas). Subcalls use
`CALL` with zero value. Functions without the `view` restriction can change
the simulated state. Later calls in the batch can read that state.

## Errors

- ABI selection and encoding errors occur before the RPC request. ox errors
  do not change.
- Invalid addresses, calldata, or provider responses throw `TypeError`.
- Requests larger than a protocol limit or a size limit from the options throw
  `RangeError`.
- Failed calls throw [`GhostcallSubcallError`](/api/subcall-error/), including
  their raw revert data.
- A response with a different number of entries throws `Error`.

The SDK does not change provider, transport, or decoding errors. For ABI
calls, the `call` field in a subcall error contains the raw calldata that the
SDK prepared.
