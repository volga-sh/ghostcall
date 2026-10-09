# ghostcall

`ghostcall` batches EVM contract reads in one `eth_call`.
It does not deploy a Multicall contract.

**Documentation: [ghostcall.volga.sh](https://ghostcall.volga.sh)**: installation
instructions, API, protocol, and size limits.

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
// TypeScript infers bigint for totalSupply.
```

## Development

Read [Development](https://ghostcall.volga.sh/development/) for installation
instructions, Yul changes, tests, and benchmarks.
