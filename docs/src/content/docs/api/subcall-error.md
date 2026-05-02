---
title: GhostcallSubcallError
description: Error thrown when a strict SDK batch encounters a failed subcall.
---

`GhostcallSubcallError` is thrown by strict SDK helpers when a subcall returns `success: false`.

The protocol still completed successfully. The error preserves the failed result entry so callers can inspect raw revert data.

## Usage

```ts
import {
	aggregateCalls,
	GhostcallSubcallError,
} from "@volga-sh/evm-ghostcall";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

try {
	await aggregateCalls(client, [
		{
			to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
			data: "0xdeadbeef",
		},
	]);
} catch (error) {
	if (error instanceof GhostcallSubcallError) {
		console.log(error.index);
		console.log(error.call);
		console.log(error.result.returnData);
	}
}
```

## Signature

```ts
class GhostcallSubcallError extends Error {
	readonly index: number;
	readonly call: GhostcallAggregateCall;
	readonly result: GhostcallFailedResult;
}
```

## Properties

### index

```ts
number
```

Zero-based index of the failed subcall.

### call

```ts
GhostcallAggregateCall
```

The original call entry passed to the SDK.

### result

```ts
type GhostcallFailedResult = {
	success: false;
	returnData: Hex;
};
```

The raw failed result entry. `returnData` contains revert data when the target call returned any.

## Thrown by

- [`aggregateDecodedCalls()`](/api/aggregate-decoded-calls/) for any failed subcall.
- [`aggregateCalls()`](/api/aggregate-calls/) when a failed subcall does not set `allowFailure: true`.

## Notes

- `GhostcallSubcallError` means the SDK rejected due to failure policy.
- Top-level RPC failures, malformed payload failures, and provider errors are separate from this error.
- Use `allowFailure: true` with `aggregateCalls()` when you want failed entries returned instead of thrown.
