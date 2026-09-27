import assert from "node:assert/strict";
import test from "node:test";
import { Abi, AbiError, AbiFunction } from "ox";
import { size as hexSize } from "ox/Hex";
import {
	aggregateCalls,
	aggregateDecodedCalls,
	encodeCalls,
	type Hex,
} from "../src/sdk/index.ts";
import { deployContract, startAnvil, stopAnvil } from "./support/anvil.ts";
import { setupMock } from "./support/ghostcall.ts";

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
				/Ghostcall subcall 0 failed/,
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

	await t.test(
		"resolves ABI overloads and mixes ABI and raw decoders in order",
		async () => {
			const abi = Abi.from([
				"function lookup(uint256 id) view returns (bool)",
				"function lookup(address owner) view returns (string)",
				"function totalSupply() view returns (uint256)",
			]);
			const byId = AbiFunction.fromAbi(abi, "lookup", { args: [7n] });
			const byOwner = AbiFunction.fromAbi(abi, "lookup", { args: [to] });
			const supply = AbiFunction.fromAbi(abi, "totalSupply");
			const idData = AbiFunction.encodeData(byId, [7n]);
			for (const [data, result] of [
				[idData, AbiFunction.encodeResult(byId, true)],
				[
					AbiFunction.encodeData(byOwner, [to]),
					AbiFunction.encodeResult(byOwner, "owner"),
				],
				[
					AbiFunction.encodeData(supply),
					AbiFunction.encodeResult(supply, 123n),
				],
			] as const)
				await write("givenCalldataReturn", [data, result]);

			const results: [boolean, string, bigint, boolean] =
				await aggregateDecodedCalls(transport, [
					{ to, abi, functionName: "lookup", args: [7n] },
					{ to, abi, functionName: "lookup", args: [to] },
					{ to, abi, functionName: "totalSupply" },
					{
						to,
						data: idData,
						decodeResult: (data) => AbiFunction.decodeResult(byId, data),
					},
				]);
			assert.deepEqual(results, [true, "owner", 123n, true]);
		},
	);

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
});

for (const [limit, codeSizeLimit, returnBytes] of [
	["CREATE", undefined, 0x6000 - 2],
	["uint15 header", 65536, 0x7fff],
] as const) {
	test(`returns one entry at the ${limit} limit`, async (t) => {
		const { transport, to, write } = await setupMock(t, codeSizeLimit);
		const returnData: Hex = `0x${"11".repeat(returnBytes)}`;
		await write("givenCalldataReturn", ["0x12345678", returnData]);
		assert.deepEqual(
			await aggregateCalls(transport, [{ to, data: "0x12345678" }]),
			[{ success: true, returnData }],
		);
	});
}

test("aggregate responses can exceed the old in-contract cap", async (t) => {
	const { transport, to, write } = await setupMock(t, 32768);
	const returnData: Hex = `0x${"00".repeat(32)}`;
	await write("givenCalldataReturn", ["0x12345678", returnData]);
	const count = Math.floor(0x6000 / (2 + hexSize(returnData))) + 1;
	const calls = Array.from({ length: count }, () => ({
		to,
		data: "0x12345678" as const,
	}));
	assert.deepEqual(
		await aggregateCalls(transport, calls),
		Array.from({ length: count }, () => ({ success: true, returnData })),
	);
});

test("reverts with empty data when an entry exceeds the uint15 header", async (t) => {
	const anvil = await startAnvil({ args: ["--code-size-limit", "65536"] });
	t.after(() => stopAnvil(anvil));
	// Deploy a runtime that returns 0x8000 bytes, one more than the packed header permits.
	const to = await deployContract(
		anvil.transport,
		"0x6006600c60003960066000f36180006000f3",
	);
	const response = await anvil.transport.request(
		{
			method: "eth_call",
			params: [{ data: encodeCalls([{ to, data: "0x" }]) }, "latest"],
		},
		{ raw: true },
	);
	assert.equal(response.error?.data, "0x");
});
