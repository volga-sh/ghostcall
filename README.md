# ghostcall

`ghostcall` batches EVM contract reads without deploying a Multicall contract.

## Documentation

Start at [ghostcall.volga.sh](https://ghostcall.volga.sh) for the setup guide,
recipes, API reference, protocol, and size limits.

## Install

```sh
npm install @volga-sh/evm-ghostcall
```

## Quick start

This example uses viem for its client and ABI definition. ghostcall uses ox
internally to encode arguments and decode results:

```sh
npm install viem
```

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import {
	createPublicClient,
	http,
	parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const abi = parseAbi(["function totalSupply() view returns (uint256)"]);
const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const [totalSupply] = await aggregateDecodedCalls(client, [
	{
		to: token,
		abi,
		functionName: "totalSupply",
	},
]);
// totalSupply is inferred as bigint.
```

Function names, arguments, and results are inferred from the ABI. Functions
with inputs require `args`, for example `args: [owner]` for `balanceOf`.
Keep ABIs literal with `as const`, viem's `parseAbi`, or ox's `Abi.from`.

Since 0.0.5, ABI-decoded addresses are checksummed, including addresses nested in
tuples and arrays. Earlier versions returned lowercase addresses.

For already-encoded calldata, use the raw API:

```ts
import { aggregateCalls } from "@volga-sh/evm-ghostcall";

const results = await aggregateCalls(client, [
	{ to: token, data: "0x18160ddd" },
]);
// [{ success: true, returnData: "0x..." }]
```

`aggregateDecodedCalls()` also accepts raw `data` with a custom `decodeResult`
callback, including in the same batch as ABI calls. Each entry uses either ABI
fields or raw calldata; TypeScript rejects entries that mix the two forms.

See [Getting Started](https://ghostcall.volga.sh/getting-started/) for a complete
two-call walkthrough.

## API

- `aggregateDecodedCalls()` accepts ABI calls or custom decoders and returns a typed result tuple.
- `aggregateCalls()` sends calls and returns raw success or failure results.
- `encodeCalls()` builds request data for an `eth_call` without `to`.
- `decodeResults()` parses a raw ghostcall response.

Read the [API reference](https://ghostcall.volga.sh/api/) for signatures,
options, return types, and errors.

The public type surface contains seven types, including ghostcall's own `Hex`.
`GhostcallAggregateCall` is merged into `GhostcallCall`. See
[type import migration](https://ghostcall.volga.sh/api/types/#migrating-type-imports)
for the removed helper aliases. Runtime exports are unchanged.

## Development

Use the latest Node.js 24 LTS release pinned in `.nvmrc`, npm 12.1.0, and
Foundry v1.8.3. CI also tests Node.js 26. Foundry installs the compiler pinned in
`foundry.toml` (Solidity 0.8.37); the EVM target stays Prague for compatibility.

```sh
nvm install
npm install --global npm@12.1.0
npm ci
npm run build:sdk
npm run test
npm run check
```

To measure SDK encoding, decoding, and batching without network latency, run
`npm run benchmark:sdk`. It reports median timings for 1, 100, and 700 calls and
sampled allocation estimates, including temporary objects collected by GC.
Allocation figures measure bytes allocated per batch, not peak or retained memory.

To work on the documentation:

```sh
npm ci --prefix docs
npm run docs:dev
npm run docs:build
```

The source is hosted at
[github.com/volga-sh/ghostcall](https://github.com/volga-sh/ghostcall).
