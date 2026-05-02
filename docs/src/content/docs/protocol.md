---
title: Protocol
description: CREATE-style execution, input payload layout, output result layout, and top-level failure behavior.
---

`src/Ghostcall.yul` is the source of truth for protocol behavior. The bundled TypeScript initcode is generated from the Foundry artifact and should not be edited directly.

## CREATE-style eth_call

An `eth_call` request with a `data` field and no `to` field executes the supplied bytes as CREATE initcode. Ghostcall uses that behavior without deploying anything:

```json
{
	"method": "eth_call",
	"params": [{ "data": "0x<ghostcall initcode><payload>" }, "latest"]
}
```

The initcode reads caller-appended bytes from its own code using `CODECOPY`, executes each subcall with zero value, and returns a packed result blob.

Subcalls use ordinary `CALL`, not `STATICCALL`. That means they execute from ghostcall's ephemeral CREATE context, and later subcalls in the same batch can observe state changes made by earlier subcalls during that one simulated execution. Each subcall also receives all remaining gas at the moment it runs, so batch order affects both state visibility and gas availability.

Provider support is still an environment concern: some RPC endpoints reject or special-case `eth_call` requests that omit `to` and rely on CREATE-style execution.

## Input payload

The caller sends:

```text
<compiled ghostcall initcode><payload>
```

The payload is a repeated list of call entries:

```text
2 bytes calldata length (big-endian uint16)
20 bytes target
N bytes calldata
```

There is no separate count field. The program advances through the appended payload until its cursor reaches the end of code. SDK-generated payloads are validated before the RPC request is sent; raw hand-built payloads must follow the wire format exactly. Malformed raw payload behavior is unspecified.

The length comes first so the Yul program can copy the 22-byte fixed header to the current memory write pointer. One `mload` exposes the length in the high two bytes and the target shifted above the trailing scratch bytes.

## Implementation notes

The bundled initcode is optimized for size, so it keeps only the checks that cannot be moved to the SDK boundary.

- The output buffer starts at memory offset `0x00`, avoiding a fixed return offset and final subtraction.
- The current output write pointer is reused as scratch for the next input header before the result entry is finalized.
- The initcode does not revalidate SDK-owned input invariants such as address shape, hex shape, calldata length encoding, or truncated raw payloads.
- The per-entry returndata length check stays in Yul because returndata size is only known after `CALL` returns.

## Output payload

The program returns a repeated list of result entries:

```text
2 bytes packed header
N bytes returndata
```

The header layout is:

```text
bit 15    success flag
bits 0-14 returndata length (big-endian uint15)
```

Subcall failures are returned inline with `success = 0` and the revert data, if any. The protocol still returns one entry per input call unless the top-level ghostcall program itself fails.

## Top-level reverts

Ghostcall intentionally fails closed for per-entry return-size overflow. These top-level reverts are empty.

Expected top-level failure cases include:

- A subcall returning more bytes than the packed result entry can represent.

Higher-level batch failure policy is SDK behavior, not Yul protocol behavior.
