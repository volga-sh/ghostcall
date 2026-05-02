---
title: Types
description: Compact catalog of shared TypeScript types exported by ghostcall.
---

Ghostcall types are hex-oriented and intentionally close to the wire format.

## Hex

```ts
type Hex = `0x${string}`;
type HexQuantity = `0x${string}`;
```

SDK boundary functions validate that hex strings have a `0x` prefix, even-length bodies, and only hexadecimal characters.

`HexQuantity` is used for RPC quantities such as `options.ethCall.gas`.

## Calls

```ts
type GhostcallCall = {
	to: Hex;
	data: Hex;
};
```

Base subcall entry. `to` is a 20-byte address and `data` is raw contract calldata.

```ts
type GhostcallAggregateCall = GhostcallCall & {
	allowFailure?: boolean;
};
```

Raw aggregate subcall entry. `allowFailure` is SDK-side policy applied after the packed response is decoded.

```ts
type GhostcallDecodedCall<TResult = unknown> = GhostcallCall & {
	decodeResult: GhostcallResultDecoder<TResult>;
};
```

Strict decoded subcall entry. Every decoded call must provide a result decoder.

## Results

```ts
type GhostcallSuccessResult = {
	success: true;
	returnData: Hex;
};

type GhostcallFailedResult = {
	success: false;
	returnData: Hex;
};

type GhostcallResult = GhostcallSuccessResult | GhostcallFailedResult;
```

The result order matches the request order.

```ts
type GhostcallResultDecoder<TResult> = (
	returnData: Hex,
	entry: GhostcallSuccessResult,
	index: number,
) => TResult;
```

Decoder callback used by `aggregateDecodedCalls()`.

```ts
type GhostcallDecodedResults<TCalls extends readonly GhostcallDecodedCall[]> = {
	-readonly [Index in keyof TCalls]: TCalls[Index] extends {
		decodeResult: GhostcallResultDecoder<infer TResult>;
	}
		? TResult
		: never;
};
```

Tuple return type inferred from decoded call inputs.

## Options

```ts
type GhostcallEncodeOptions = {
	maxInitcodeBytes?: number;
};
```

Controls the maximum full CREATE initcode payload size. Defaults to `49,152`.

```ts
type GhostcallBlockReference = string | number | bigint;

type GhostcallEthCallOptions = {
	from?: Hex;
	gas?: HexQuantity;
	blockTag?: GhostcallBlockReference;
};
```

Outer `eth_call` controls. Decimal block numbers passed as strings, numbers, or bigints are normalized to hex quantities.

```ts
type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	ethCall?: GhostcallEthCallOptions;
};
```

Shared options for `aggregateCalls()` and `aggregateDecodedCalls()`.

## Provider

```ts
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};
```

Minimal provider shape used by the SDK.
