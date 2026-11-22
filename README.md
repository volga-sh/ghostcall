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

Read one wallet's balance in three tokens with a single RPC request:

```ts
import { aggregateDecodedCalls } from "@volga-sh/evm-ghostcall";
import { createPublicClient, erc20Abi, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({ chain: mainnet, transport: http() });

const wallet = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const dai = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

// Three reads, one eth_call. Results come back in call order.
const [wethBalance, usdcBalance, daiBalance] = await aggregateDecodedCalls(client, [
	{ to: weth, abi: erc20Abi, functionName: "balanceOf", args: [wallet] },
	{ to: usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet] },
	{ to: dai, abi: erc20Abi, functionName: "balanceOf", args: [wallet] },
]);
// Each balance is inferred as bigint.
```

## Development

See [Development](https://ghostcall.volga.sh/development/) for setup, the Yul
workflow, tests, and benchmarks.
