---
title: Limits
description: Initcode, calldata, returndata, and provider limits that affect ghostcall batches.
---

Ghostcall has both protocol-level limits and environment-level limits. Treat them as hard constraints when building batches.

## Per-call calldata

Each input entry stores calldata length as a big-endian `uint16`, so a single subcall can include at most `65,535` bytes of calldata.

`encodeCalls()` enforces this limit before sending an RPC request.

## CREATE initcode

The full request data is CREATE initcode:

```text
<bundled ghostcall initcode><payload>
```

On Ethereum, EIP-3860 caps initcode at `49,152` bytes. Other chains may differ. RPC providers may also apply their own lower request-size limits.

`encodeCalls()` rejects batches whose encoded CREATE payload exceeds the SDK's configured initcode ceiling. If you do not pass `maxInitcodeBytes`, it defaults to Ethereum's `49,152`-byte EIP-3860 limit.

## Return data

Each result entry stores returndata length in 15 bits, so a single packed result entry can represent at most `32,767` bytes of returndata.

On Ethereum, EIP-170's returned-code limit is usually stricter: CREATE-style execution returns would-be runtime bytecode, so the aggregate response is commonly capped at `24,576` bytes including the 2-byte header for every entry.

Provider behavior can be more restrictive than chain consensus limits. Measure the actual endpoint you plan to use.

## Benchmarking an endpoint

The repository includes a rough probing script:

```sh
npm run benchmark:limits -- --rpc-url "$RPC_URL" --mode raw
```

`raw` mode probes accepted CREATE initcode bytes and returned runtime-code bytes. `balances` mode uses a realistic ERC-20 balance workload:

```sh
npm run benchmark:limits -- \
  --rpc-url "$RPC_URL" \
  --mode balances \
  --token "$TOKEN_ADDRESS" \
  --owner "$OWNER_ADDRESS"
```

Useful options include:

- `--mode raw|balances|all`
- `--block`, `--from`, `--gas`, and `--timeout-ms`
- `--max-calls`, `--max-initcode-bytes`, and `--max-runtime-bytes`
- `--json`
