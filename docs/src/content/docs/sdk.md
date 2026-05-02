---
title: SDK API
description: Public TypeScript SDK functions, types, validation behavior, and result shapes.
---

The SDK is a thin translation layer over the ghostcall wire format. It does not read runtime artifacts, include ABI helpers, or depend on a particular provider library.

## Hex

All request and response bytes are represented as `0x`-prefixed hex strings.

```ts
type Hex = `0x${string}`;
```

At runtime, SDK boundary functions reject values that are not strings, do not start with `0x`, have odd-length hex bodies, or contain non-hex characters.

## encodeCalls()

```ts
function encodeCalls(
	calls: readonly GhostcallCall[],
	options?: GhostcallEncodeOptions,
): Hex;

type GhostcallCall = {
	to: Hex;
	data: Hex;
};

type GhostcallEncodeOptions = {
	maxInitcodeBytes?: number;
};
```

`encodeCalls()` returns the full CREATE-style request payload:

```text
<bundled ghostcall initcode><encoded call entries>
```

Each call becomes one binary entry in the same order:

```text
2 bytes calldata length
20 bytes target address
N bytes calldata
```

Validation is intentionally eager:

- `to` must be exactly 20 bytes.
- `data` must be valid even-length hex.
- A single call's data must fit in `uint16`, so it cannot exceed `65,535` bytes.
- The full initcode plus payload must fit the configured CREATE initcode ceiling.

If `maxInitcodeBytes` is omitted, the SDK defaults to Ethereum's EIP-3860 limit of `49,152` bytes.

## decodeResults()

```ts
function decodeResults(data: Hex): GhostcallResult[];

type GhostcallResult = {
	success: boolean;
	returnData: Hex;
};
```

`decodeResults()` parses the packed response blob returned by ghostcall. It preserves result ordering and returns an empty array for `0x`.

Each result entry is encoded as:

```text
2 bytes packed header
N bytes returndata
```

The packed header uses bit 15 as the success flag and bits 0-14 as the returndata length. Truncated headers and truncated result bodies throw `TypeError`.

## aggregateCalls()

```ts
async function aggregateCalls(
	provider,
	calls,
	options?,
): Promise<GhostcallResult[]>;
```

`aggregateCalls()` performs the provider-facing flow:

1. Encode the call list with `encodeCalls()`.
2. Send `eth_call` with `{ data }` and any configured `from` / `gas`, without a `to`.
3. Decode the packed response with `decodeResults()`.
4. Enforce result count and failure policy.

The aggregate options also accept outer `eth_call` controls:

```ts
type GhostcallEthCallOptions = {
	from?: Hex;
	gas?: `0x${string}`;
	blockTag?: string | number | bigint;
};
```

`blockTag` accepts named tags such as `latest`, `safe`, and `finalized`, canonical hex quantities such as `0x1234`, and decimal block numbers passed as strings, numbers, or bigints. Decimal inputs are normalized to hex quantities before the RPC request is sent.

Subcalls run in order, use ordinary `CALL`, and each one receives all remaining gas at the point it executes. That means earlier calls can affect later ones through both ephemeral state changes and gas consumption.

`aggregateCalls()` always returns raw entries:

```ts
const results = await aggregateCalls(provider, [
	{
		// WETH9 on Ethereum mainnet: totalSupply()
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: "0x18160ddd",
	},
]);
```

Strict mode throws `GhostcallSubcallError` when a subcall fails. The error preserves the failed index, original call, and raw `{ success: false, returnData }` entry so callers can inspect revert data without switching to `allowFailure: true`.

## aggregateDecodedCalls()

```ts
async function aggregateDecodedCalls(
	provider,
	calls,
	options?,
): Promise<GhostcallDecodedResults>;
```

`aggregateDecodedCalls()` uses the same transport flow as `aggregateCalls()`, but it is the strict decoded helper:

- its TypeScript input requires `decodeResult` on every call
- its TypeScript input does not accept `allowFailure`
- any failed subcall rejects with `GhostcallSubcallError`

Use it when you want decoded values directly:

```ts
const erc20Abi = parseAbi(["function totalSupply() view returns (uint256)"]);
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const [totalSupply] = await aggregateDecodedCalls(
	provider,
	[
		{
			to: weth,
			data: "0x18160ddd",
			decodeResult: (returnData) =>
				decodeFunctionResult({
					abi: erc20Abi,
					functionName: "totalSupply",
					data: returnData,
				}),
		},
	],
);
```
