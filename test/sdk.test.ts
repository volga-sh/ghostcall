import assert from "node:assert/strict";
import test from "node:test";
import { size as hexSize } from "ox/Hex";
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	type GhostcallAggregateOptions,
	type GhostcallCall,
	type GhostcallDecodedCall,
	GhostcallSubcallError,
	type Hex,
} from "../src/sdk/index.ts";

const call = {
	to: "0x1111111111111111111111111111111111111111",
	data: "0x",
} satisfies GhostcallCall;
const providerReturning = (
	result: unknown,
): Parameters<typeof aggregateCalls>[0] => ({ request: async () => result });

test("encodes ordered uint16-length/address/calldata entries after the initcode", () => {
	const base = encodeCalls([]);
	const first = { ...call, data: "0xaAbB" } satisfies GhostcallCall;
	const second = {
		to: "0x2222222222222222222222222222222222222222",
		data: "0x",
	} satisfies GhostcallCall;
	assert.equal(encodeCalls([first]), `${base}0002${first.to.slice(2)}aAbB`);
	assert.equal(
		encodeCalls([first, second]),
		`${base}0002${first.to.slice(2)}aAbB0000${second.to.slice(2)}`,
	);
});

test("enforces calldata and full CREATE request ceilings at their boundaries", () => {
	const baseSize = hexSize(encodeCalls([]));
	const maxSizedCall = {
		...call,
		data: `0x${"00".repeat(0xffff)}`,
	} satisfies GhostcallCall;
	const maxInitcodeBytes = baseSize + 22 + 0xffff;
	assert.equal(
		hexSize(encodeCalls([maxSizedCall], { maxInitcodeBytes })),
		maxInitcodeBytes,
	);
	assert.throws(
		() =>
			encodeCalls([maxSizedCall], { maxInitcodeBytes: maxInitcodeBytes - 1 }),
		RangeError,
	);
	assert.throws(
		() =>
			encodeCalls([{ ...call, data: `${maxSizedCall.data}00` }], {
				maxInitcodeBytes: maxInitcodeBytes + 1,
			}),
		/65535-byte calldata limit/,
	);
	assert.throws(
		() => encodeCalls([], { maxInitcodeBytes: baseSize - 1 }),
		RangeError,
	);
	for (const maxInitcodeBytes of [-1, 1.5, NaN, Infinity]) {
		assert.throws(() => encodeCalls([], { maxInitcodeBytes }), TypeError);
	}
	const batch = Array.from(
		{ length: Math.floor((0xc000 - baseSize) / 22) },
		() => call,
	);
	assert.ok(hexSize(encodeCalls(batch)) <= 0xc000);
	assert.throws(() => encodeCalls([...batch, call]), RangeError);
});

test("rejects malformed caller hex and addresses", () => {
	const invalid: unknown[] = [
		{ ...call, to: "0x1234" },
		{ ...call, to: `0xzz${"11".repeat(19)}` },
		{ ...call, to: 123 },
		...["1234", "0xabc", "0xzz", "0x00\n", 123].map((data) => ({
			...call,
			data,
		})),
	];
	// Exercise the untyped boundary; valid fixtures are checked with satisfies.
	for (const input of invalid)
		assert.throws(() => encodeCalls([input as GhostcallCall]), TypeError);
});

test("decodes ordered successes and failures, rejecting malformed or truncated responses", () => {
	assert.deepEqual(decodeResults("0x"), []);
	assert.deepEqual(decodeResults("0x8002cafe0003deadbe8000"), [
		{ success: true, returnData: "0xcafe" },
		{ success: false, returnData: "0xdeadbe" },
		{ success: true, returnData: "0x" },
	]);
	for (const data of [
		"0x00",
		"0x8002ff",
		"0x8000ff",
		"0xabc",
		"0xzz",
	] as const) {
		assert.throws(() => decodeResults(data), TypeError);
	}
});

test("decodes upper- and lowercase headers across uint15 length boundaries", () => {
	const expected = [];
	let response: Hex = "0x";
	for (const length of [
		0, 1, 9, 10, 15, 16, 255, 256, 0xabc, 0xdef, 4095, 4096, 32767,
	]) {
		const returnData: Hex = `0x${"aB".repeat(length)}`;
		for (const success of [false, true]) {
			const header = ((success ? 0x8000 : 0) | length)
				.toString(16)
				.padStart(4, "0");
			expected.push({ success, returnData });
			response = `${response}${success ? header.toUpperCase() : header}${returnData.slice(2)}`;
		}
	}
	assert.deepEqual(decodeResults(response), expected);
	assert.throws(() => decodeResults(`${response}8FFF`), /Truncated.*body/);
	assert.throws(() => decodeResults(`${response}8`), TypeError);
	assert.throws(() => decodeResults(`${response}zzzz`), TypeError);
});

test("forwards CREATE-style eth_call options and preserves raw failure entries", async (t) => {
	const calls = [call, { ...call, allowFailure: true }];
	const request = t.mock.fn<Parameters<typeof aggregateCalls>[0]["request"]>(
		async () => "0x8001aa0001bb",
	);
	const results = await aggregateCalls({ request }, calls, {
		ethCall: { from: call.to, gas: "0x5208", blockTag: 123 },
	});
	assert.equal(request.mock.callCount(), 1);
	assert.deepEqual(request.mock.calls[0]?.arguments, [
		{
			method: "eth_call",
			params: [
				{ data: encodeCalls(calls), from: call.to, gas: "0x5208" },
				"0x7b",
			],
		},
	]);
	assert.deepEqual(results, [
		{ success: true, returnData: "0xaa" },
		{ success: false, returnData: "0xbb" },
	]);
});

test("decodes custom results with their successful entry and batch index", async (t) => {
	const decode = t.mock.fn((data: Hex) => Number.parseInt(data.slice(2), 16));
	const calls = [
		{ ...call, decodeResult: decode },
		{ ...call, decodeResult: (data) => data.toUpperCase() },
	] as const satisfies readonly GhostcallDecodedCall[];
	assert.deepEqual(
		await aggregateDecodedCalls(providerReturning("0x80012a8002babe"), calls),
		[42, "0XBABE"],
	);
	assert.deepEqual(decode.mock.calls[0]?.arguments, [
		"0x2a",
		{ success: true, returnData: "0x2a" },
		0,
	]);
});

test("failed calls never reach success decoders, including hidden allowFailure fields", async (t) => {
	const provider = providerReturning("0x00012a");
	const decodeResult = t.mock.fn(() => 42);
	await assert.rejects(aggregateCalls(provider, [call]), GhostcallSubcallError);
	await assert.rejects(
		aggregateDecodedCalls(provider, [{ ...call, decodeResult }]),
		GhostcallSubcallError,
	);
	const original = { ...call, decodeResult, allowFailure: true };
	// Structural typing can hide an extra field without removing it at runtime (P1).
	const erased: Omit<GhostcallCall, "allowFailure"> & {
		decodeResult: typeof decodeResult;
	} = original;
	await assert.rejects(
		aggregateDecodedCalls(provider, [erased]),
		(error: unknown) => {
			assert.ok(error instanceof GhostcallSubcallError);
			assert.equal(error.index, 0);
			assert.equal(error.call, original);
			assert.deepEqual(error.result, { success: false, returnData: "0x2a" });
			return true;
		},
	);
	assert.equal(decodeResult.mock.callCount(), 0);
});

test("rejects invalid provider responses and mismatched result counts", async () => {
	for (const response of [123, "0xzz", "0x00", "0x8002ff"]) {
		await assert.rejects(
			aggregateCalls(providerReturning(response), [call]),
			TypeError,
		);
	}
	for (const response of ["0x", "0x80008000"]) {
		await assert.rejects(
			aggregateCalls(providerReturning(response), [call]),
			/result entries for 1 calls/,
		);
	}
});

test("normalizes block references and rejects invalid outer options before RPC", async (t) => {
	const request = t.mock.fn<Parameters<typeof aggregateCalls>[0]["request"]>(
		async () => "0x",
	);
	for (const [blockTag, expected] of [
		[0, "0x0"],
		[123n, "0x7b"],
		["00123", "0x7b"],
		["0XAb", "0xAb"],
		["pending", "pending"],
	] as const) {
		await aggregateCalls({ request }, [], { ethCall: { blockTag } });
		assert.deepEqual(request.mock.calls.at(-1)?.arguments[0]?.params, [
			{ data: encodeCalls([]) },
			expected,
		]);
	}
	request.mock.resetCalls();
	const invalid: unknown[] = [
		{ from: "0x1234" },
		...["123", "0x00", "0x", -1].map((gas) => ({ gas })),
		...[
			-1,
			-1n,
			"-0",
			"",
			"0x00",
			1.5,
			NaN,
			Infinity,
			Number.MAX_SAFE_INTEGER + 1,
		].map((blockTag) => ({ blockTag })),
	];
	for (const ethCall of invalid) {
		await assert.rejects(
			aggregateCalls({ request }, [call], {
				ethCall,
			} as GhostcallAggregateOptions),
			TypeError,
		);
	}
	assert.equal(request.mock.callCount(), 0);
});
