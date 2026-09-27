import { readFile } from "node:fs/promises";
import type { TestContext } from "node:test";
import { type Abi, AbiFunction } from "ox";
import type { Hex } from "../../src/sdk/index.ts";
import {
	deployContract,
	sendTransaction,
	startAnvil,
	stopAnvil,
	type Transport,
} from "./anvil.ts";

/** Start an isolated chain and deploy the real mock contract; writes wait for receipts. */
async function setupMock(
	t: TestContext,
	codeSizeLimit?: number,
): Promise<{
	transport: Transport;
	to: Hex;
	write(name: string, args?: readonly unknown[]): Promise<void>;
}> {
	const anvil = await startAnvil({
		args:
			codeSizeLimit === undefined
				? []
				: ["--code-size-limit", String(codeSizeLimit)],
	});
	t.after(() => stopAnvil(anvil));
	const { abi, bytecode } = JSON.parse(
		await readFile(
			new URL("../../out/MockContract.sol/MockContract.json", import.meta.url),
			"utf8",
		),
	) as { abi: Abi.Abi; bytecode: { object: Hex } };
	const to = await deployContract(anvil.transport, bytecode.object);
	return {
		transport: anvil.transport,
		to,
		async write(name, args = []) {
			await sendTransaction(anvil.transport, {
				to,
				data: AbiFunction.encodeData(abi, name, args),
			});
		},
	};
}

export { setupMock };
