import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import { RpcTransport, type TransactionReceipt } from "ox";
import type { Hex } from "../../src/sdk/index.ts";

const defaultSender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

type Transport = RpcTransport.Http<false>;

type AnvilInstance = {
	child: ReturnType<typeof spawn>;
	transport: Transport;
};

async function startAnvil({
	args = [],
}: {
	args?: readonly string[];
} = {}): Promise<AnvilInstance> {
	const port = await getFreePort();
	const url = `http://127.0.0.1:${port}`;
	const logs: string[] = [];

	const child = spawn(
		"anvil",
		["--host", "127.0.0.1", "--port", String(port), ...args],
		{
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	for (const stream of [child.stdout, child.stderr]) {
		stream.on("data", (chunk: Buffer | string) => logs.push(chunk.toString()));
	}

	const transport: Transport = RpcTransport.fromHttp(url);

	try {
		await waitForRpc(transport, child, logs);
	} catch (error) {
		await stopAnvil({ child, transport });
		throw error;
	}

	return { child, transport };
}

async function stopAnvil(anvil: AnvilInstance): Promise<void> {
	const { child } = anvil;
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}

	const exit = once(child, "exit");
	child.kill("SIGTERM");

	// The fallback timer must not keep the test process alive after Anvil exits.
	await Promise.race([exit, sleep(2_000, undefined, { ref: false })]);

	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await exit;
	}
}

async function deployContract(
	transport: Transport,
	bytecode: Hex,
): Promise<Hex> {
	const receipt = await sendTransaction(transport, { data: bytecode });
	assert.ok(
		receipt.contractAddress,
		"Deployment receipt is missing its contract address",
	);
	return receipt.contractAddress;
}

async function sendTransaction(
	transport: Transport,
	request: { to?: Hex; data: Hex },
): Promise<TransactionReceipt.Rpc> {
	const hash = await transport.request({
		method: "eth_sendTransaction",
		params: [
			{
				from: defaultSender,
				...request,
			},
		],
	});

	const receipt = await waitForReceipt(transport, hash);
	assert.equal(
		receipt.status,
		"0x1",
		`Transaction ${hash} reverted unexpectedly`,
	);

	return receipt;
}

async function waitForRpc(
	transport: Transport,
	child: ReturnType<typeof spawn>,
	logs: string[],
): Promise<void> {
	const timeoutAt = Date.now() + 10_000;

	while (Date.now() < timeoutAt) {
		if (child.exitCode !== null) {
			throw new Error(`anvil exited before becoming ready\n${logs.join("")}`);
		}

		try {
			await transport.request({ method: "eth_blockNumber" });
			return;
		} catch {
			await sleep(100);
		}
	}

	throw new Error(
		`Timed out waiting for anvil to become ready\n${logs.join("")}`,
	);
}

async function waitForReceipt(
	transport: Transport,
	hash: Hex,
): Promise<TransactionReceipt.Rpc> {
	const timeoutAt = Date.now() + 10_000;

	while (Date.now() < timeoutAt) {
		const receipt = await transport.request({
			method: "eth_getTransactionReceipt",
			params: [hash],
		});

		if (receipt) {
			return receipt;
		}

		await sleep(100);
	}

	throw new Error(`Timed out waiting for receipt for ${hash}`);
}

async function getFreePort(): Promise<number> {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	const closed = once(server, "close");
	server.close();
	await closed;
	assert.ok(
		address && typeof address !== "string",
		"Could not determine a free TCP port",
	);
	return address.port;
}

export type { Transport };
export { deployContract, sendTransaction, startAnvil, stopAnvil };
