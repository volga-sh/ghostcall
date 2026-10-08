# ghostcall

`ghostcall` batches EVM contract reads into one `eth_call` without deploying a
Multicall contract.

**Documentation: [ghostcall.volga.sh](https://ghostcall.volga.sh)**: getting
started, API reference, protocol, and size limits.

## Install

```sh
npm install @volga-sh/evm-ghostcall
```

## Example

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });
const abi = parseAbi(["function totalSupply() view returns (uint256)"]);
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const [totalSupply] = await aggregateDecodedCalls(client, [
	{ to: weth, abi, functionName: "totalSupply" },
]);
// totalSupply is inferred as bigint.
```

## Development

See [Development](https://ghostcall.volga.sh/development/) for setup, the Yul
workflow, tests, and benchmarks.
