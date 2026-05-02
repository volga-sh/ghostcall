---
title: ghostcall
description: ghostcall is a zero-deployment batching program for CREATE-style eth_call requests.
---

Batch contract reads without relying on a deployed Multicall contract.

```sh
npm install @volga-sh/evm-ghostcall
```

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
```

`aggregateDecodedCalls()` is the fastest path for application code: pass an EIP-1193-style provider, raw call entries, and one `decodeResult` callback per call. Ghostcall sends one CREATE-style `eth_call`, preserves call order, and returns the decoded values as a typed tuple.

Start with the [getting started guide](/getting-started/), jump into the [API reference](/api/), or browse the source on [GitHub](https://github.com/volga-sh/ghostcall).

The SDK is intentionally provider-agnostic and hex-oriented. Bring viem, ox, ethers, or your own ABI helpers for function encoding and result decoding.

## What ghostcall provides

- No deployed Multicall dependency.
- A small TypeScript SDK for encoding, sending, and decoding batches.
- Raw `0x` input and output boundaries, with ABI policy left to your app.
- Explicit protocol, request-size, and result-size limits.

## When it fits

Use ghostcall when you want a small provider-agnostic batching primitive for read-only contract calls, especially when you do not want to depend on a specific deployed multicall address.

Provider support is still an environment concern. Some RPC endpoints reject or special-case `eth_call` requests without a `to` field, so test the exact endpoint you plan to use.
