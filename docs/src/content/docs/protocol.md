---
title: Protocol
description: The ghostcall request and response formats.
---

This page gives the request and response formats.
You can use the SDK to make a request.

## Contract creation through eth_call

An `eth_call` usually has a `to` address.
If the request has no `to` address, the EVM reads the `data` as initcode:

```json
{
	"method": "eth_call",
	"params": [{ "data": "0x<ghostcall program><calls>" }, "latest"]
}
```

Initcode is the code that runs during contract creation.
The ghostcall initcode reads the call entries after its own code.
It runs the calls in order and returns their results.
An empty batch uses a separate 3-byte initcode program.
That program returns an empty response.
`encodeCalls([])` makes this empty request.
The RPC request only simulates these operations.
The chain does not keep a new contract or state changes.

Some RPC endpoints do not accept `eth_call` without a `to` address.
Do a test of the endpoint that the application uses.

## Call operation

Each subcall uses the EVM `CALL` instruction with zero value.

A target can change state during the simulation.
A later call in the same batch can read that changed state.
The chain does not keep these changes after `eth_call` ends.
`STATICCALL` does not let a target change state.

Each call gets the gas that remains when the call starts.
Earlier calls decrease the gas that later calls can use.

## Request bytes

The request contains the compiled ghostcall program before the call entries:

```text
<compiled ghostcall program><call><call>...
```

Each call has a 22-byte header and its calldata.
The length is a big-endian uint16.
Offsets are in bytes:

```text
0             2                         22           22 + N
+-------------+-------------------------+------------+
| length      | target address          | calldata   |
| 2 bytes     | 20 bytes                | N bytes    |
+-------------+-------------------------+------------+
```

The request has no call count.
The cursor is the address of the next call entry.
The program stops when the cursor is at the end of the request.

`encodeCalls()` does a check of addresses, hex strings, calldata lengths, and the full request size.
The program does not do these checks in the EVM.
This keeps the program small.
Use this layout to make a request manually.
End the request at an entry boundary.
The protocol does not give specified results for incorrect requests.

## Response bytes

The response contains one entry for each call:

```text
2 bytes header
N bytes return data
```

The header has these fields:

```text
bit 0     call success
bits 1-15 return data length (big-endian uint15)
header    return data length * 2 + success bit
```

A failed subcall still has a response entry.
Its success bit is `0`.
The entry contains the revert data if the target gives revert data.
`decodeResults()` rejects entries with missing header bytes or return data.

Use the program, encoder, and decoder from the same version.

## Failure of the full request

ghostcall stops with an EVM error and no response if one call returns more than `32,767` bytes.

The outer `eth_call` can also fail if it uses all the available gas.
The chain or RPC client can stop a request because of the request size or response size.
Chains with [EIP-3541](https://eips.ethereum.org/EIPS/eip-3541) reject a CREATE response that starts with `0xef`.
Refer to [Limits](/limits/#first-byte-of-the-response) for these lengths.
These failures do not give a batch response.
The SDK gives the provider error to the caller.

## Next

- Read [Limits](/limits/) for request and response limits.
- Read [`encodeCalls()`](/api/encode-calls/) and
  [`decodeResults()`](/api/decode-results/) for the byte format.
