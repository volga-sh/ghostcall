import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import { RpcTransport, type TransactionReceipt } from "ox";
import type { Hex } from "../../src/sdk/index.ts";

const defaultSender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

type Transport = RpcTransport.Http<false>;

/**
 * Start anvil on a port that the OS selects.
 * Return the transport when anvil listens on the port.
 */
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
		// Read both pipes so a full log buffer cannot stop anvil.
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

// Anvil stores temporary state.
// Stop it without a shutdown procedure.
async function stopAnvil(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exit = once(child, "exit");
	child.kill("SIGKILL");
	await exit;
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

	// Anvil returns the hash before it mines the transaction.
	// Wait for the receipt before you continue.
	let receipt: TransactionReceipt.Rpc | null = null;
	for (let attempt = 0; receipt === null && attempt < 1_000; attempt += 1) {
		if (attempt > 0) await sleep(10);
		receipt = await transport.request({
			method: "eth_getTransactionReceipt",
			params: [hash],
		});
	}
	assert.ok(receipt, `Timed out waiting for receipt for ${hash}`);
	assert.equal(
		receipt.status,
		"0x1",
		`Transaction ${hash} reverted unexpectedly`,
	);

	return receipt;
}

export type { Transport };
export { deployContract, sendTransaction, startAnvil, stopAnvil };
