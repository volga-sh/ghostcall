import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import { RpcTransport, type TransactionReceipt } from "ox";
import type { Hex } from "../../src/sdk/index.ts";

const defaultSender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

type Transport = RpcTransport.Http<false>;

/** Start anvil on an OS-assigned port and resolve once it is listening. */
async function startAnvil(
	args: readonly string[] = [],
): Promise<{ child: ChildProcess; transport: Transport }> {
	const child = spawn(
		"anvil",
		["--host", "127.0.0.1", "--port", "0", ...args],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let logs = "";
	const listening = Promise.withResolvers<string>();
	for (const stream of [child.stdout, child.stderr]) {
		// Keep draining both pipes so anvil never blocks on a full log buffer.
		stream.on("data", (chunk: Buffer) => {
			logs += chunk.toString();
			const address = /Listening on (\S+)/.exec(logs)?.[1];
			if (address) listening.resolve(address);
		});
	}
	child.once("error", listening.reject);
	child.once("exit", () =>
		listening.reject(new Error(`anvil exited before listening\n${logs}`)),
	);
	const timeout = setTimeout(
		() => listening.reject(new Error(`Timed out waiting for anvil\n${logs}`)),
		10_000,
	);

	try {
		const address = await listening.promise;
		return { child, transport: RpcTransport.fromHttp(`http://${address}`) };
	} catch (error) {
		await stopAnvil(child);
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

async function stopAnvil(child: ChildProcess): Promise<void> {
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

export type { Transport };
export { deployContract, sendTransaction, startAnvil, stopAnvil };
