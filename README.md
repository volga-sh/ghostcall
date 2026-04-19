# evm-zcall

`evm-zcall` is a zero-deployment batching program for CREATE-style `eth_call`.

Instead of calling a deployed Multicall contract, the client sends compiled initcode plus an
appended payload. The EVM executes that initcode exactly as if it were deploying a contract, but
because the transport is `eth_call`, nothing is persisted. Whatever the initcode `RETURN`s comes
back as the RPC result.

The implementation lives in [`src/ZCall.yul`](/Users/mmv/Projects/Personal/evm-zcall/src/ZCall.yul).

## Why this works

- `eth_call` without a `to` field executes the supplied `data` as CREATE initcode.
- Initcode can read caller-appended bytes from its own code using `CODECOPY`.
- Initcode can perform `STATICCALL`s, pack the returned bytes into memory, and `RETURN` them.
- Returned bytes are still subject to CREATE limits because the client treats them as would-be
  runtime bytecode.

The original low-level feasibility checks are still preserved in
[`scripts/poc.sh`](/Users/mmv/Projects/Personal/evm-zcall/scripts/poc.sh).

## Current scope

This implementation is intentionally focused on the cleanest read-only variant:

- `STATICCALL` only
- packed binary input instead of ABI encoding
- packed binary output instead of ABI encoding
- per-call `allowFailure`

That keeps the initcode small, auditable, and easy to extend.

## Input format

The caller sends:

```text
<compiled zcall initcode><payload>
```

Payload layout:

```text
4 bytes  magic = "ZCL1"
N bytes  repeated call entries
```

Each call entry:

```text
20 bytes target
 1 byte  flags, bit 0 = allowFailure
 2 bytes calldata length (big-endian uint16)
 N bytes calldata
```

Notes:

- Payload bytes are not normal calldata. They are appended after the compiled initcode and read via
  `CODECOPY`.
- Per-call calldata is limited to `65535` bytes because the format uses `uint16`.
- The whole CREATE payload is still limited by the initcode size ceiling.

## Output format

The program returns:

```text
4 bytes  magic = "ZCR1"
N bytes  repeated result entries
```

Each result entry:

```text
 1 byte  success flag
 2 bytes returndata length (big-endian uint16)
 N bytes returndata
```

If a subcall fails and `allowFailure` is unset, the whole aggregate reverts with:

- `ZCallFailed(uint256)` selector `0x2dd41103`

Other top-level validation errors use:

- `ZCallMalformedPayload()` selector `0x0ea77364`
- `ZCallReturnTooLarge()` selector `0xe5f212d6`

## Limits

Observed against local `anvil`:

- maximum returned CREATE data: `24,576` bytes
- maximum initcode size: `49,152` bytes

Those limits apply directly here because the returned batch result is interpreted as would-be
runtime code.

## Build

```bash
forge build
```

The compiled initcode is emitted into the standard Foundry artifact tree. The integration script
reads it from [`out/ZCall.yul/ZCall.json`](/Users/mmv/Projects/Personal/evm-zcall/out/ZCall.yul/ZCall.json).

## Integration check

1. Start `anvil` on `http://127.0.0.1:8545`.
2. Run:

```bash
./scripts/test_zcall.sh
```

The integration script:

- compiles the Yul source,
- deploys a tiny contract that returns `0x11223344`,
- deploys a tiny contract that always reverts,
- executes a CREATE-style `eth_call` against ZCall,
- verifies the success path, allowed-failure path, and revert path.

## Design notes

The implementation chooses Yul over raw bytecode because it keeps the control flow legible while
still mapping one-to-one onto the EVM concepts that matter here:

- `dataoffset(...)` anchors the appended payload boundary
- `codecopy` loads the appended payload
- `staticcall` performs read-only subcalls
- `returndatacopy` packs the aggregate response
- `return` hands the batch result back to RPC

That gives you a maintainable base version first, with a straightforward path to hand-optimizing
hot spots later if initcode size becomes the bottleneck.
