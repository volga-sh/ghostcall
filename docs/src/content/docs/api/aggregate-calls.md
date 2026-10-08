---
title: aggregateCalls
description: Send a batch and return raw success or failure results.
---

`aggregateCalls()` sends one `eth_call` and returns one
[`GhostcallResult`](/api/types/) per call, in call order. Use it when success
flags or revert data are needed, or when selected calls may fail.

## Usage

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const results = await aggregateCalls(client, [
	// totalSupply()
	{ to: weth, data: "0x18160ddd" },
	// If this call reverts, it returns success: false instead of throwing.
	{ to: weth, data: "0xdeadbeef", allowFailure: true },
]);

for (const { success, returnData } of results) console.log(success, returnData);
```

## Signature

```ts twoslash
import { aggregateCalls } from "@volga-sh/evm-ghostcall";
//       ^?
```

See [Types](/api/types/) for each type.

- `provider` needs a compatible `request` method, such as a viem client or an ox
  transport.
- `calls` run in order. Set `allowFailure: true` to return that entry with
  `success: false` instead of throwing. The SDK applies it after the response
  arrives; it is not sent to the EVM.
- `options` apply to the whole batch. `maxInitcodeBytes` defaults to `49,152`.

## Block, sender, and gas

`ethCall` sets the outer `eth_call`. `blockTag` takes a `bigint` block number or
a named tag and defaults to `"latest"`. Omitted `from` and `gas` use provider
defaults.

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
- `RangeError` when one call or the full request exceeds its size limit.
- [`GhostcallSubcallError`](/api/subcall-error/) when a call fails without
  `allowFailure: true`.
- `Error` when the response contains a different number of results than the
  request.

Provider and transport errors pass through unchanged.

Use [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) when every call
must succeed and decoded values are needed.
