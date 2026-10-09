---
title: aggregateCalls
description: Send a batch and return raw success or failure results.
---

`aggregateCalls()` sends one `eth_call` and returns one
[`GhostcallResult`](/api/types/) for each call, in the call order. Use it to get
the success flags or the revert data. Also use it if a call can revert.

## Usage

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const results = await aggregateCalls(client, [
	// totalSupply()
	{ to: weth, data: "0x18160ddd" },
	// If this call reverts, its result has success: false. No error occurs.
	{ to: weth, data: "0xdeadbeef", allowFailure: true },
]);

for (const { success, returnData } of results) console.log(success, returnData);
```

## Signature

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";
//       ^?
```

For each type, refer to [Types](/api/types/).

- `provider` must have a compatible `request` method, for example a viem client
  or an ox transport.
- The calls execute in order. To get a result with `success: false` and no
  error, set `allowFailure: true` for that call. The SDK uses this setting after
  it gets the response. The SDK does not send it to the EVM.
- `options` are for the full batch. The default for `maxInitcodeBytes` is
  `49,152`.
- For an empty list of calls, the function returns `[]`. It does not send an RPC
  request.

## Block, sender, and gas

`ethCall` sets the outer `eth_call`. `blockTag` is a `bigint` block number or a
named tag. The default is `"latest"`. If you do not set `from` or `gas`, the
provider uses its default values.

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
// ---cut---
const [result] = await aggregateCalls(client, [{ to: weth, data: "0x18160ddd" }], {
	ethCall: {
		blockTag: 19_000_000n,
		from: "0x0000000000000000000000000000000000000000",
		gas: 3_000_000n,
	},
});
```

## Throws

- `TypeError` for incorrect addresses, hex data, or provider responses.
- `RangeError` if one call or the full request is larger than its size limit.
- [`GhostcallSubcallError`](/api/subcall-error/) if a call has `success: false`
  and does not set `allowFailure: true`.
- `Error` if the number of results in the response is different from the number
  of calls.

The function does not change provider errors and transport errors.

To get decoded values, and an error for each call with `success: false`, use
[`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/).
