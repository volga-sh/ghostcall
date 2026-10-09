---
title: Limits
description: Size limits for ghostcall calls, requests, and responses.
---

Do a check of these limits before you make a large batch.
A chain or RPC provider can use a lower limit.

## Calldata for each call

Each call stores its calldata length in two bytes.
One call can contain at most `65,535` bytes of calldata.

`encodeCalls()` does not accept larger values.
The SDK finds these errors before it sends an RPC request.

## Full request

The request contains the ghostcall program and all the encoded calls:

```text
<ghostcall program><encoded calls>
```

Ethereum has a `49,152`-byte initcode limit under EIP-3860.
Other chains can use different limits.
An RPC provider can set a lower limit.

A request with calls uses the 60-byte ghostcall program.
Each call adds a 22-byte header and its calldata.
The full request size is `60 + sum(22 + calldata bytes)`.
A request with no calls uses a separate 3-byte program.

`encodeCalls()` uses `49,152` bytes as the default limit.
Use `maxInitcodeBytes` to set a different limit:

```ts twoslash
import { encodeCalls, type GhostcallCall } from "@volga-sh/evm-ghostcall";
declare const calls: GhostcallCall[];
// ---cut---
const data = encodeCalls(calls, {
	maxInitcodeBytes: 32_000,
});
```

## Return data for each call

Each result stores its length in a 15-bit field.
One call can return at most `32,767` bytes of data.
The ghostcall program stops with an EVM error and no response if a result is larger.

The available gas and chain or RPC limits can decrease this limit.

## Full response

Ethereum usually has a `24,576`-byte limit for returned contract code under EIP-170.
The EVM reads a CREATE-style `eth_call` response as contract code.
This limit can apply to the full ghostcall response.
Each two-byte header is part of this response.
The full response size is `sum(2 + return-data bytes)`.

A successful ERC-20 `balanceOf` call has 58 request bytes.
Its response has 34 bytes.
A `24,576`-byte response can contain at most 722 such results.
An empty result still has a two-byte header.
The same limit lets a response contain at most 12,288 empty results.

Other chains and RPC providers can use different limits.
Do a test of the endpoint that the application uses.

### First byte of the response

Chains with [EIP-3541](https://eips.ethereum.org/EIPS/eip-3541) reject a CREATE response that starts with `0xef`.
The first result gives this prefix when its return data has `30,592` through `30,719` bytes.
Revert data can give the same prefix.
Later results do not change the first byte of the response.

## Do an endpoint test

The repository has a script to measure request and response limits.
Use this command to measure the limits:

```sh
npm run benchmark:limits -- --rpc-url "$RPC_URL" --mode raw
```

Use this command for a test with ERC-20 balance calls:

```sh
npm run benchmark:limits -- \
  --rpc-url "$RPC_URL" \
  --mode balances \
  --token "$TOKEN_ADDRESS" \
  --owner "$OWNER_ADDRESS"
```

Run the script with `--help` to show all options.
These options set the block, sender, gas, timeout, maximum search value, and JSON output.

## Next

- Use [`encodeCalls()`](/api/encode-calls/) to set the request size limit.
- Read [Protocol](/protocol/) for the length field definitions.
