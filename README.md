# ghostcall

`ghostcall` is a zero-deployment batching SDK for CREATE-style `eth_call` requests.

## Documentation

The docs live at [ghostcall.volga.sh](https://ghostcall.volga.sh).

Start there for installation, examples, the API reference, protocol details, and endpoint limit notes.

## Install

```sh
npm install @volga-sh/evm-ghostcall
```

## Quick Start

This example uses viem for the EIP-1193-compatible client and ABI helpers. Install it with `npm install viem` if your app does not already use it.

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import {
	createPublicClient,
	decodeFunctionResult,
	encodeFunctionData,
	http,
	parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
	chain: mainnet,
	transport: http(),
});

const erc20Abi = parseAbi(["function totalSupply() view returns (uint256)"]);

const [totalSupply] = await aggregateDecodedCalls(client, [
	{
		to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: "totalSupply",
		}),
		decodeResult: (returnData) =>
			decodeFunctionResult({
				abi: erc20Abi,
				functionName: "totalSupply",
				data: returnData,
			}),
	},
]);
```

See the [Getting Started guide](https://ghostcall.volga.sh/getting-started/) for a complete viem example with ABI encoding and decoding.

## API

- `aggregateDecodedCalls()` sends a strict batch and returns decoded values.
- `aggregateCalls()` sends a batch and returns raw `{ success, returnData }` entries.
- `encodeCalls()` builds the CREATE-style `eth_call` data payload.
- `decodeResults()` parses the packed ghostcall response.

Full reference: [API docs](https://ghostcall.volga.sh/api/).

## Development

```sh
npm install
npm run build:sdk
npm run test
npm run check
```

Docs are built with Astro Starlight:

```sh
npm run docs:dev
npm run docs:build
```

The repository is hosted at [github.com/volga-sh/ghostcall](https://github.com/volga-sh/ghostcall).
