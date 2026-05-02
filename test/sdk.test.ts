import assert from "node:assert/strict";
import test from "node:test";

import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
} from "../src/sdk/index.ts";

const maxCreateInitcodeSize = 0xc000;
const encodedCallHeaderSize = 0x16;
const optimizedBundledInitcodeSize = 91;

test("Ghostcall SDK", async (t) => {
	await t.test("supports empty call lists and custom initcode ceilings", () => {
		const data = encodeCalls([]);
		const bundledInitcodeSize = byteLength(data);

		assert.match(data, /^0x[0-9a-fA-F]+$/);
		assert.notEqual(data, "0x");
		assert.throws(
			() => encodeCalls([], { maxInitcodeBytes: bundledInitcodeSize - 1 }),
			RangeError,
		);
	});

	await t.test("pins the bundled optimized initcode size", () => {
		assert.equal(byteLength(encodeCalls([])), optimizedBundledInitcodeSize);
	});

	await t.test("encodes calldata at the uint16 limit", () => {
		const baseData = encodeCalls([]);
		const maxSizedCall = {
			to: "0x1111111111111111111111111111111111111111",
			data: `0x${"00".repeat(0xffff)}` as `0x${string}`,
		} as const;
		const maxInitcodeBytes =
			(baseData.length - 2) / 2 + encodedCallHeaderSize + 0xffff;

		const encoded = encodeCalls([maxSizedCall], { maxInitcodeBytes });

		assert.equal(
			(encoded.length - 2) / 2,
			(baseData.length - 2) / 2 + encodedCallHeaderSize + 0xffff,
		);
	});

	await t.test(
		"encodes single and multi-call payloads with len-first headers",
		() => {
			const baseData = encodeCalls([]);
			const firstCall = {
				to: "0x1111111111111111111111111111111111111111",
				data: "0xaabb",
			} as const;
			const secondCall = {
				to: "0x2222222222222222222222222222222222222222",
				data: "0x",
			} as const;

			assert.equal(
				encodeCalls([firstCall]),
				`${baseData}0002${firstCall.to.slice(2)}aabb`,
			);
			assert.equal(
				encodeCalls([firstCall, secondCall]),
				`${baseData}0002${firstCall.to.slice(2)}aabb0000${secondCall.to.slice(2)}`,
			);
		},
	);

	await t.test("rejects invalid addresses", () => {
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1234" as const,
						data: "0x",
					},
				]),
			TypeError,
		);
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0xzz11111111111111111111111111111111111111" as const,
						data: "0x",
					},
				]),
			TypeError,
		);
	});

	await t.test("rejects invalid calldata hex", () => {
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "1234" as unknown as `0x${string}`,
					},
				]),
			TypeError,
		);
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "0xabc" as const,
					},
				]),
			TypeError,
		);
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "0xzz" as const,
					},
				]),
			TypeError,
		);
	});

	await t.test("rejects calldata over the uint16 limit", () => {
		assert.throws(
			() =>
				encodeCalls([
					{
						to: "0x1111111111111111111111111111111111111111",
						data: `0x${"00".repeat(0x10000)}` as `0x${string}`,
					},
				]),
			RangeError,
		);
	});

	await t.test("enforces the CREATE initcode size limit", () => {
		const baseData = encodeCalls([]);
		const emptyCall = {
			to: "0x1111111111111111111111111111111111111111",
			data: "0x",
		} as const;
		const bundledInitcodeSize = (baseData.length - 2) / 2;
		const maxEmptyCalls = Math.floor(
			(maxCreateInitcodeSize - bundledInitcodeSize) / encodedCallHeaderSize,
		);

		const maxSizedBatch = Array.from(
			{ length: maxEmptyCalls },
			() => emptyCall,
		);
		const maxSizedData = encodeCalls(maxSizedBatch, {
			maxInitcodeBytes: maxCreateInitcodeSize,
		});

		assert.ok((maxSizedData.length - 2) / 2 <= maxCreateInitcodeSize);
		assert.throws(
			() =>
				encodeCalls([...maxSizedBatch, emptyCall], {
					maxInitcodeBytes: maxCreateInitcodeSize,
				}),
			RangeError,
		);
	});

	await t.test("decodes empty and mixed result payloads", () => {
		assert.deepEqual(decodeResults("0x"), []);
		assert.deepEqual(decodeResults("0x8002cafe0003deadbe"), [
			{ success: true, returnData: "0xcafe" },
			{ success: false, returnData: "0xdeadbe" },
		]);
	});

	await t.test("rejects truncated result headers and bodies", () => {
		assert.throws(() => decodeResults("0x00"), TypeError);
		assert.throws(() => decodeResults("0x8002ff"), TypeError);
	});

	await t.test(
		"forwards CREATE-style eth_call params and returns raw results",
		async () => {
			const calls = [
				{
					to: "0x1111111111111111111111111111111111111111",
					data: "0xaabb",
				},
				{
					to: "0x2222222222222222222222222222222222222222",
					data: "0x",
					allowFailure: true,
				},
			] as const;
			const requests: unknown[] = [];
			const provider = {
				async request(args: {
					method: string;
					params?: unknown;
				}): Promise<unknown> {
					requests.push(args);
					return "0x8001aa0001bb";
				},
			};

			const results = await aggregateCalls(provider, calls, {
				ethCall: {
					from: "0x3333333333333333333333333333333333333333",
					gas: "0x5208",
					blockTag: 123,
				},
			});

			assert.deepEqual(requests, [
				{
					method: "eth_call",
					params: [
						{
							data: encodeCalls(calls),
							from: "0x3333333333333333333333333333333333333333",
							gas: "0x5208",
						},
						"0x7b",
					],
				},
			]);
			assert.deepEqual(results, [
				{ success: true, returnData: "0xaa" },
				{ success: false, returnData: "0xbb" },
			]);
		},
	);

	await t.test(
		"returns decoded values directly through aggregateDecodedCalls",
		async () => {
			const calls = [
				{
					to: "0x1111111111111111111111111111111111111111",
					data: "0xaabb",
					decodeResult: (returnData: `0x${string}`) =>
						Number.parseInt(returnData.slice(2), 16),
				},
				{
					to: "0x2222222222222222222222222222222222222222",
					data: "0xccdd",
					decodeResult: (returnData: `0x${string}`) => returnData.toUpperCase(),
				},
			] as const;
			const provider = {
				async request(): Promise<unknown> {
					return "0x80012a8002babe";
				},
			};

			const results = await aggregateDecodedCalls(provider, calls);

			assert.deepEqual(results, [42, "0XBABE"]);
		},
	);

	await t.test(
		"rejects failed decoded subcalls through aggregateDecodedCalls",
		async () => {
			const decodeResult = (returnData: `0x${string}`) => returnData;
			const provider = {
				async request(): Promise<unknown> {
					return "0x0001ff";
				},
			};

			await assert.rejects(
				aggregateDecodedCalls(provider, [
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "0x",
						decodeResult,
					},
				]),
				(error: unknown) => {
					assert.ok(error instanceof GhostcallSubcallError);
					assert.equal(error.message, "Ghostcall subcall 0 failed");
					assert.equal(error.index, 0);
					assert.deepEqual(error.call, {
						to: "0x1111111111111111111111111111111111111111",
						data: "0x",
						decodeResult,
					});
					assert.deepEqual(error.result, {
						success: false,
						returnData: "0xff",
					});
					return true;
				},
			);
		},
	);

	await t.test(
		"rejects failed subcalls unless allowFailure is set",
		async () => {
			const provider = {
				async request(): Promise<unknown> {
					return "0x0001ff";
				},
			};

			await assert.rejects(
				aggregateCalls(provider, [
					{
						to: "0x1111111111111111111111111111111111111111",
						data: "0x",
					},
				]),
				(error: unknown) => {
					assert.ok(error instanceof GhostcallSubcallError);
					assert.equal(error.message, "Ghostcall subcall 0 failed");
					assert.equal(error.index, 0);
					assert.deepEqual(error.call, {
						to: "0x1111111111111111111111111111111111111111",
						data: "0x",
					});
					assert.deepEqual(error.result, {
						success: false,
						returnData: "0xff",
					});
					return true;
				},
			);
		},
	);

	await t.test("rejects malformed aggregate provider results", async () => {
		const call = {
			to: "0x1111111111111111111111111111111111111111",
			data: "0x",
		} as const;
		const nonHexProvider = {
			async request(): Promise<unknown> {
				return 123;
			},
		};
		const missingEntryProvider = {
			async request(): Promise<unknown> {
				return "0x";
			},
		};

		await assert.rejects(
			aggregateCalls(nonHexProvider, [call]),
			/eth_call result must be a hex string/,
		);
		await assert.rejects(
			aggregateCalls(missingEntryProvider, [call]),
			/Ghostcall returned 0 result entries for 1 calls/,
		);
	});

	await t.test(
		"rejects invalid outer eth_call options before RPC",
		async () => {
			const call = {
				to: "0x1111111111111111111111111111111111111111",
				data: "0x",
			} as const;
			const provider = {
				async request(): Promise<unknown> {
					assert.fail("invalid eth_call options should not reach the provider");
				},
			};

			await assert.rejects(
				aggregateCalls(provider, [call], {
					ethCall: { from: "0x1234" as const },
				}),
				/options\.ethCall\.from must be a 20-byte hex string/,
			);
			await assert.rejects(
				aggregateCalls(provider, [call], {
					ethCall: { gas: "123" as never },
				}),
				/options\.ethCall\.gas must be a 0x-prefixed hex quantity/,
			);
			await assert.rejects(
				aggregateCalls(provider, [call], {
					ethCall: { blockTag: -1 as never },
				}),
				/options\.ethCall\.blockTag must be a non-negative safe integer, bigint, or non-empty string/,
			);
			await assert.rejects(
				aggregateCalls(provider, [call], {
					ethCall: { blockTag: "" },
				}),
				/options\.ethCall\.blockTag must be a non-negative safe integer, bigint, or non-empty string/,
			);
		},
	);
});

function byteLength(value: `0x${string}`): number {
	return (value.length - 2) / 2;
}
