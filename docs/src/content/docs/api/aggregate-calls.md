---
title: aggregateCalls
description: Send a batch and return raw success or failure results.
---

`aggregateCalls()` sends one `eth_call` and returns one
[`GhostcallResult`](/api/types/) per call. Results have the same order as the
calls. Use this function to read success flags and revert data. You can also
let selected calls fail.

## Usage

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const results = await aggregateCalls(client, [
	// totalSupply()
	{ to: weth, data: "0x18160ddd" },
	// If this call reverts, the result contains success: false.
	{ to: weth, data: "0xdeadbeef", allowFailure: true },
]);

for (const { success, returnData } of results) console.log(success, returnData);
```

## Signature

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";
//       ^?
```

Refer to [Types](/api/types/) for each type.

- `provider` must have an EIP-1193 `request` method. A viem client or an ox
  transport can supply this method.
- `calls` run in order. Set `allowFailure: true` to get a failed entry with
  `success: false`. The SDK uses this option after it receives the response.
  The option does not go to the EVM.
- The SDK uses `options` for the full batch. The default value of `maxInitcodeBytes` is
  `49,152`.

## Block, sender, and gas

`ethCall` contains options for the outer `eth_call`. Use a `bigint` block
number or a named tag for `blockTag`. Its default value is `"latest"`. If you do not supply `from` or
`gas`, the provider uses its default values.

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

- `TypeError` for invalid addresses, hex data, or provider responses.
- `RangeError` when one call or the full request is larger than its size limit.
- [`GhostcallSubcallError`](/api/subcall-error/) when a call fails without
  `allowFailure: true`.
- `Error` when the number of results is different from the number of calls.

The SDK does not change provider or transport errors.

Use [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) to get decoded
values. This function throws an error if a call fails.
