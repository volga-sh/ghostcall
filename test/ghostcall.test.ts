import assert from "node:assert/strict";
import test from "node:test";
import { AbiError, AbiFunction } from "ox";
import {
	aggregateCalls,
	aggregateDecodedCalls,
	encodeCalls,
	GhostcallSubcallError,
	type Hex,
} from "../src/sdk/index.ts";
import { setupMock } from "./support/mock.ts";

test("ghostcall integration", async (t) => {
	const { transport, to, write } = await setupMock(t);
	t.beforeEach(() => write("reset"));

	await t.test(
		"preserves revert data and continues to later calls",
		async () => {
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
		},
	);

	await t.test("executes empty batches", async () => {
		assert.deepEqual(await aggregateCalls(transport, []), []);
	});

	await t.test("packs unaligned results after staging calldata", async () => {
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
	});

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
			// The 2-byte result header counts toward EIP-170's returned-code limit.
			const returnData: Hex = `0x${"11".repeat(0x6000 - 2)}`;
			await write("givenCalldataReturn", ["0x12345678", returnData]);
			assert.deepEqual(
				await aggregateCalls(transport, [{ to, data: "0x12345678" }]),
				[{ success: true, returnData }],
			);
		},
	);
});

test("packs entries up to the uint15 header and reverts with empty data beyond it", async (t) => {
	// Raise anvil's returned-code limit so only ghostcall's own limits apply.
	const { transport, to, write } = await setupMock(t, 65536);
	const maxEntry: Hex = `0x${"11".repeat(0x7fff)}`;
	const smallEntry: Hex = `0x${"22".repeat(32)}`;
	await write("givenCalldataReturn", ["0x11111111", maxEntry]);
	await write("givenCalldataReturn", ["0x22222222", smallEntry]);
	await write("givenCalldataReturn", [
		"0x33333333",
		`0x${"33".repeat(0x8000)}`,
	]);

	// The 32,805-byte response also shows ghostcall adds no aggregate size cap.
	assert.deepEqual(
		await aggregateCalls(transport, [
			{ to, data: "0x11111111" },
			{ to, data: "0x22222222" },
		]),
		[
			{ success: true, returnData: maxEntry },
			{ success: true, returnData: smallEntry },
		],
	);
	const response = await transport.request(
		{
			method: "eth_call",
			params: [{ data: encodeCalls([{ to, data: "0x33333333" }]) }, "latest"],
		},
		{ raw: true },
	);
	assert.equal(response.error?.data, "0x");
});
