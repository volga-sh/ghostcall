---
title: Protocol
description: The request bytes, the response bytes, and the execution of a ghostcall batch.
---

This page gives the bytes that you send to ghostcall and the bytes that it
returns. Most SDK users do not make these bytes.

## Contract creation through eth_call

An `eth_call` to a contract has a `to` address. If an `eth_call` has no `to`
address, the EVM executes the `data` as contract creation code. The name of this
code is initcode:

```json
{
	"method": "eth_call",
	"params": [{ "data": "0x<ghostcall program><calls>" }, "latest"]
}
```

ghostcall uses this creation step for a program that executes one time. The
program reads the call entries after its own code, executes the calls, and
returns the results. An `eth_call` does not write a transaction to the chain.
Thus no contract is deployed, and no state change stays after the `eth_call`.

Some RPC endpoints do not accept an `eth_call` without a `to` address. Do a test
of the endpoint that your application uses.

## Call execution

The program executes the calls in order. It uses the EVM `CALL` instruction with
zero value.

`CALL` is different from `STATICCALL`. A target can change the state during the
`eth_call`, and a later call in the same batch can see that change. No change
stays after the `eth_call` ends.

Each call gets the gas that is available when the call starts. Thus the gas that
the previous calls use decreases the gas for the later calls.

## Request bytes

The request contains the compiled ghostcall program, then one entry for each
call:

```text
[program][entry 0][entry 1]...[entry n-1]
```

Each entry has this layout:

```text
+---------------------+------------------+----------------+
| calldata length     | target address   | calldata       |
| 2 bytes, uint16     | 20 bytes         | N bytes        |
| (big-endian)        |                  |                |
+---------------------+------------------+----------------+
```

The request has no call count. The program reads entries until it gets to the
end of the request data.

A request must contain one or more entries. The program executes the first
entry before it does the end check. If a request has no entries, the `eth_call`
stops with an error. The SDK does not send an empty batch:

- `aggregateCalls()` and `aggregateDecodedCalls()` return `[]` for an empty
  batch. They do not send an RPC request.
- `encodeCalls()` throws a `RangeError` for an empty list of calls.

`encodeCalls()` does a check of the addresses, the hex strings, the calldata
lengths, and the full request size. The program does not do a check of the
request bytes, because the checks make the program larger. If an entry is not
complete, the program also reads the memory after the request. If there are
bytes after the last entry, the program executes them as one more call. If you make the request bytes yourself, use the same layout. The results
of an incorrect request are not defined.

## Program memory

The program copies all of its code into memory one time. It reads each entry
from this copy, and `CALL` reads the calldata from the copy. The program writes
the results after the copy:

```text
0          program size  entry        code size    write pointer
|          |             |            |            |
+----------+-------------+------------+------------+
| program  | entries     | entries    | results    |
|          | (done)      | (not done) |            |
+----------+-------------+------------+------------+
|<-------- copy of the code --------->|<- RETURN ->|
```

The results start after the copy. Thus a result cannot overwrite an entry that
the program did not read.

## Response bytes

The response contains one result for each call, in the call order:

```text
[result 0][result 1]...[result n-1]
```

Each result has this layout:

```text
+---------------------+----------------+
| header              | return data    |
| 2 bytes, uint16     | N bytes        |
| (big-endian)        |                |
+---------------------+----------------+
```

The header contains two fields:

```text
bits 1-15   return data length (uint15)
bit 0       success bit
```

Thus `header = length * 2 + success`. For example, the header `0x0005` gives a
success bit of `1` and 2 bytes of return data.

A call that reverts also has a result. Its success bit is `0`. Its return data
contains the revert data, if the call returned revert data.

## Whole-request failure

If one call returns more than `32,767` bytes, the full `eth_call` stops with an
error. The program must find this condition, because it gets the return size
only after the call.

For this return data, the program copies from a nonzero offset. Thus the copy
reads after the end of the return data. The EVM stops the execution with an
exceptional halt. The RPC returns an error with no revert data and no results.

The SDK uses these rules for a call with `success: false`:

- `aggregateDecodedCalls()` throws for each call with `success: false`.
- `aggregateCalls()` throws, but not for a call with `allowFailure: true`.
- `decodeResults()` returns the success bit and does not throw.

## Next

- Refer to [Limits](/limits/) for the request and response limits.
- Refer to [`encodeCalls()`](/api/encode-calls/) and
  [`decodeResults()`](/api/decode-results/) to use the byte format.
