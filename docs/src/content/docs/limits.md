---
title: Limits
description: Size limits for ghostcall calls, requests, and responses.
---

Use these limits for large batches. A chain or an RPC provider can set a lower
limit than the protocol.

## Calldata per call

Each entry keeps its calldata length in 2 bytes. Thus the maximum calldata for
one call is `65,535` bytes.

If a call has more calldata, `encodeCalls()` throws a `RangeError`. The SDK does
not send an RPC request.

## Full request

The request data contains the ghostcall program and all of the encoded calls:

```text
<ghostcall program><encoded calls>
```

On Ethereum, EIP-3860 sets a limit of `49,152` bytes for contract creation code.
Other chains can use a different limit. An RPC provider can also have a lower
limit.

The bundled ghostcall program has `61` bytes.

A request must contain one or more calls. For an empty list of calls,
`encodeCalls()` throws a `RangeError`.

`encodeCalls()` uses `49,152` bytes as the default limit. To set a different
limit, use `maxInitcodeBytes`:

```ts twoslash
import { encodeCalls, type GhostcallCall } from "@volga-sh/evm-ghostcall";
declare const calls: GhostcallCall[];
// ---cut---
const data = encodeCalls(calls, {
	maxInitcodeBytes: 32_000,
});
```

## Return data per call

Each result keeps its return data length in 15 bits. Thus the maximum return
data for one result is `32,767` bytes.

If a call returns more bytes, the full `eth_call` stops with an error. The error
has no revert data.

## Full response

On Ethereum, EIP-170 sets a limit of `24,576` bytes for returned contract code.
A CREATE-style `eth_call` uses the ghostcall response as contract code. Thus a
node can use this limit for the full response, with the 2-byte header of each
result.

Other chains and RPC providers can have a higher or a lower limit. Do a test of
the endpoint that your application uses.

## Test an endpoint

The repository has a script that finds the request and response limits of an
endpoint:

```sh
npm run benchmark:limits -- --rpc-url "$RPC_URL" --mode raw
```

To do a test with ERC-20 balance calls, use this command:

```sh
npm run benchmark:limits -- \
  --rpc-url "$RPC_URL" \
  --mode balances \
  --token "$TOKEN_ADDRESS" \
  --owner "$OWNER_ADDRESS"
```

To see the options for the block, the sender, the gas, the timeout, the search
maximum, and the JSON output, use `--help`.

## Next

- To set the maximum request size, use [`encodeCalls()`](/api/encode-calls/).
- For the length fields that cause these limits, refer to the
  [Protocol](/protocol/).
