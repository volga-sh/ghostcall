import assert from "node:assert/strict";
import test from "node:test";
import { AbiError, AbiFunction } from "ox";
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
	type Hex,
} from "../src/sdk/index.ts";
import { deployContract, startAnvil, stopAnvil } from "./support/anvil.ts";
import { setupMock } from "./support/mock.ts";

test("ghostcall integration", async (t) => {
	const { transport, to, write } = await setupMock(t);
	t.beforeEach(() => write("reset"));

	await t.test("keeps revert data and continues to later calls", async () => {
		await write("givenCalldataRevertWithMessage", [
			"0x11111111",
			"mocked revert",
		]);
		await write("givenCalldataReturn", ["0x22222222", "0xabcd"]);
		const calls = [
			{ to, data: "0x11111111" },
			{ to, data: "0x22222222" },
		] as const;
		await assert.rejects(
			aggregateCalls(transport, calls),
			GhostcallSubcallError,
		);
		const [failure, success] = await aggregateCalls(transport, [
			{ ...calls[0], allowFailure: true },
			calls[1],
		]);
		assert.ok(failure);
		assert.equal(failure.success, false);
		const error = AbiError.fromAbi([], failure.returnData);
		assert.equal(AbiError.decode(error, failure.returnData), "mocked revert");
		assert.deepEqual(success, { success: true, returnData: "0xabcd" });
	});

	await t.test("runs empty batches through CREATE-style eth_call", async () => {
		assert.deepEqual(await aggregateCalls(transport, []), []);
	});

	await t.test(
		"runs zero-length entries through the exact payload end",
		async () => {
			const zeroAddress = "0x0000000000000000000000000000000000000000";
			const emptyTarget = "0x1111111111111111111111111111111111111111";
			assert.deepEqual(
				await aggregateCalls(transport, [
					{ to: zeroAddress, data: "0x" },
					{ to: emptyTarget, data: "0x123456" },
					{ to: zeroAddress, data: "0x" },
				]),
				Array.from({ length: 3 }, () => ({ success: true, returnData: "0x" })),
			);
		},
	);

	await t.test(
		"packs unaligned results without overwriting later input",
		async () => {
			const cases = [
				[`0x${"aa".repeat(40)}`, "0xaa"],
				[`0x${"bb".repeat(7)}`, "0xbbccdd"],
			] as const satisfies readonly [Hex, Hex][];
			for (const [data, result] of cases)
				await write("givenCalldataReturn", [data, result]);
			assert.deepEqual(
				await aggregateCalls(
					transport,
					cases.map(([data]) => ({ to, data })),
				),
				cases.map(([, returnData]) => ({ success: true, returnData })),
			);
		},
	);

	await t.test(
		"CALL exposes same-batch state changes to later calls",
		async () => {
			const balance = AbiFunction.from(
				"function balanceOf(address) view returns (uint256)",
			);
			const count = AbiFunction.from(
				"function invocationCount() returns (uint256)",
			);
			await write("givenMethodReturn", [
				AbiFunction.encodeData(balance, [to]),
				AbiFunction.encodeResult(balance, 123n),
			]);
			assert.deepEqual(
				await aggregateDecodedCalls(transport, [
					{ to, abi: [balance], functionName: "balanceOf", args: [to] },
					{ to, abi: [count], functionName: "invocationCount" },
				]),
				[123n, 1n],
			);
		},
	);

	await t.test(
		"returns one entry at the default 24,576-byte CREATE return limit",
		async () => {
			// The result header counts toward the EIP-170 limit for returned code.
			const returnData: Hex = `0x${"11".repeat(0x6000 - 2)}`;
			await write("givenCalldataReturn", ["0x12345678", returnData]);
			assert.deepEqual(
				await aggregateCalls(transport, [{ to, data: "0x12345678" }]),
				[{ success: true, returnData }],
			);
		},
	);
});

test("keeps uint15 return and revert data and stops on an oversized entry", async (t) => {
	// Increase the chain limit for returned code to test the per-entry limit.
	const { transport, to, write } = await setupMock(t, 65536);
	// Each 7-byte runtime copies calldata to memory.
	// RETURN and REVERT use the same bytes.
	const echo = await deployContract(
		transport,
		"0x6007600a5f3960075ff3365f5f37365ff3",
	);
	const revertEcho = await deployContract(
		transport,
		"0x6007600a5f3960075ff3365f5f37365ffd",
	);
	const laterCall = { to: echo, data: "0xabcd" } as const;
	const maxReturnData: Hex = `0x${"11".repeat(0x7fff)}`;
	for (const [target, success] of [
		[echo, true],
		[revertEcho, false],
	] as const) {
		assert.deepEqual(
			await aggregateCalls(transport, [
				{ to: target, data: maxReturnData, allowFailure: true },
				laterCall,
			]),
			[
				{ success, returnData: maxReturnData },
				{ success: true, returnData: laterCall.data },
			],
		);
	}

	const oversizedData: Hex = `0x${"33".repeat(0x8000)}`;
	for (const target of [echo, revertEcho]) {
		const oversizedCall = { to: target, data: oversizedData };
		for (const calls of [
			[oversizedCall, laterCall],
			[laterCall, oversizedCall],
		]) {
			const response = await transport.request(
				{
					method: "eth_call",
					params: [{ data: encodeCalls(calls) }, "latest"],
				},
				{ raw: true },
			);
			// RETURNDATACOPY reads past the end of the data and stops the full request.
			assert.ok(response.error);
			assert.match(response.error.message, /OutOfOffset|out of bounds/i);
		}
	}

	const smallEntry: Hex = `0x${"22".repeat(32)}`;
	await write("givenCalldataReturn", ["0x11111111", maxReturnData]);
	await write("givenCalldataReturn", ["0x22222222", smallEntry]);

	// The output is larger than the input and does not overwrite the second request entry.
	// The response also shows that ghostcall adds no batch size limit.
	assert.deepEqual(
		await aggregateCalls(transport, [
			{ to, data: "0x11111111" },
			{ to, data: "0x22222222" },
		]),
		[
			{ success: true, returnData: maxReturnData },
			{ success: true, returnData: smallEntry },
		],
	);
});

test("EIP-3541 stops a batch when the first result header starts with 0xef", async (t) => {
	// Increase the code size limit above the size of these responses.
	const { child, transport } = await startAnvil(["--code-size-limit", "65536"]);
	t.after(() => stopAnvil(child));
	const echo = await deployContract(
		transport,
		"0x6007600a5f3960075ff3365f5f37365ff3",
	);
	const revertEcho = await deployContract(
		transport,
		"0x6007600a5f3960075ff3365f5f37365ffd",
	);
	for (const length of [30_591, 30_592, 30_719, 30_720]) {
		const returnData: Hex = `0x${"11".repeat(length)}`;
		for (const [to, success] of [
			[echo, true],
			[revertEcho, false],
		] as const) {
			const response = await transport.request(
				{
					method: "eth_call",
					params: [{ data: encodeCalls([{ to, data: returnData }]) }, "latest"],
				},
				{ raw: true },
			);
			if (length >= 30_592 && length <= 30_719) {
				assert.ok(response.error);
				assert.equal(response.error.code, -32003);
				assert.match(response.error.message, /CreateContractStartingWithEF/);
				assert.equal(response.error.data, undefined);
				assert.equal(response.result, undefined);
			} else {
				assert.equal(response.error, undefined);
				assert.ok(response.result);
				assert.deepEqual(decodeResults(response.result), [
					{ success, returnData },
				]);
			}
		}
	}

	// A later entry does not change the first byte of the response.
	const returnData: Hex = `0x${"11".repeat(30_592)}`;
	for (const [to, success] of [
		[echo, true],
		[revertEcho, false],
	] as const) {
		assert.deepEqual(
			await aggregateCalls(transport, [
				{ to: "0x0000000000000000000000000000000000000000", data: "0x" },
				{ to, data: returnData, allowFailure: true },
			]),
			[
				{ success: true, returnData: "0x" },
				{ success, returnData },
			],
		);
	}
});
