import assert from "node:assert/strict";
import test from "node:test";
import { size as hexSize } from "ox/Hex";
import {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	type GhostcallCall,
	type GhostcallDecodedCall,
	type GhostcallProvider,
	type GhostcallResult,
	GhostcallSubcallError,
	ghostcallInitcode,
	type Hex,
} from "../src/sdk/index.ts";

const call = {
	to: "0x1111111111111111111111111111111111111111",
	data: "0x",
} satisfies GhostcallCall;
const callWithSize = (size: number): GhostcallCall => ({
	...call,
	data: `0x${"00".repeat(size)}`,
});
const providerReturning = (result: unknown): GhostcallProvider => ({
	request: async () => result,
});

test("encodes ordered uint16-length/address/calldata entries after the initcode", () => {
	const base = ghostcallInitcode;
	// Pin the bundled program size so initcode changes are explicit.
	assert.equal(hexSize(base), 60);
	const first = { ...call, data: "0xaAbB" } satisfies GhostcallCall;
	const second = {
		to: "0x2222222222222222222222222222222222222222",
		data: "0x",
	} satisfies GhostcallCall;
	assert.equal(
		encodeCalls([first, second]),
		`${base}0002${first.to.slice(2)}aAbB0000${second.to.slice(2)}`,
	);
});

test("enforces calldata and full CREATE request ceilings at their boundaries", () => {
	const baseSize = hexSize(ghostcallInitcode);
	// Two entries reach the default 49,152-byte ceiling exactly.
	const defaultFit = 0xc000 - baseSize - 2 * 22;
	assert.equal(hexSize(encodeCalls([callWithSize(defaultFit), call])), 0xc000);
	assert.throws(
		() => encodeCalls([callWithSize(defaultFit + 1), call]),
		RangeError,
	);

	const maxInitcodeBytes = baseSize + 22 + 0xffff;
	assert.equal(
		hexSize(encodeCalls([callWithSize(0xffff)], { maxInitcodeBytes })),
		maxInitcodeBytes,
	);
	assert.throws(
		() => encodeCalls([callWithSize(0x10000)], { maxInitcodeBytes }),
		/65535-byte calldata limit/,
	);
});

test("an empty batch returns no results without an RPC request and cannot be encoded", async (t) => {
	const request = t.mock.fn<GhostcallProvider["request"]>();
	assert.deepEqual(await aggregateCalls({ request }, []), []);
	assert.deepEqual(await aggregateDecodedCalls({ request }, []), []);
	assert.equal(request.mock.callCount(), 0);
	assert.throws(() => encodeCalls([]), RangeError);
});

test("rejects addresses and calldata that the Hex type admits but the wire format does not", async () => {
	const invalid: GhostcallCall[] = [
		{ ...call, to: "0x1234" },
		{ ...call, to: `0xzz${"11".repeat(19)}` },
		{ ...call, data: "0xabc" },
		{ ...call, data: "0xzz" },
		{ ...call, data: "0x00\n" },
	];
	for (const input of invalid)
		assert.throws(() => encodeCalls([input]), TypeError);
	await assert.rejects(
		aggregateCalls(providerReturning("0x"), [call], {
			ethCall: { from: "0x1234" },
		}),
		/options\.ethCall\.from must be a 20-byte hex string/,
	);
});

test("decodes mixed-case headers across uint15 length boundaries and rejects malformed responses", () => {
	assert.deepEqual(decodeResults("0x"), []);
	const expected: GhostcallResult[] = [];
	let response: Hex = "0x";
	for (const length of [0, 1, 0xabc, 0x7fff]) {
		const returnData: Hex = `0x${"aB".repeat(length)}`;
		for (const success of [false, true]) {
			const header = (length * 2 + Number(success))
				.toString(16)
				.padStart(4, "0");
			expected.push({ success, returnData });
			response = `${response}${success ? header.toUpperCase() : header}${returnData.slice(2)}`;
		}
	}
	assert.deepEqual(decodeResults(response), expected);
	for (const [data, error] of [
		["0x00", /Truncated/],
		["0x0001ff", /Truncated/],
		["0x0005ff", /Truncated/],
		["0xabc", /even-length/],
		["0xzz", /even-length/],
	] as const) {
		assert.throws(() => decodeResults(data), error);
	}
});

test("forwards CREATE-style eth_call options and returns allowed failures", async (t) => {
	const calls = [call, { ...call, allowFailure: true }];
	const request = t.mock.fn<GhostcallProvider["request"]>(
		async () => "0x0003aa0002bb",
	);
	const results = await aggregateCalls({ request }, calls, {
		ethCall: { from: call.to, gas: 21_000n, blockTag: 123n },
	});
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

test("decodes custom results with their batch index", async (t) => {
	const decode = t.mock.fn((data: Hex) => Number.parseInt(data.slice(2), 16));
	const calls = [
		{ ...call, decodeResult: decode },
		{ ...call, decodeResult: (data) => data.toUpperCase() },
	] as const satisfies readonly GhostcallDecodedCall[];
	assert.deepEqual(
		await aggregateDecodedCalls(providerReturning("0x00032a0005babe"), calls),
		[42, "0XBABE"],
	);
	assert.deepEqual(decode.mock.calls[0]?.arguments, ["0x2a", 0]);
});

test("failed calls throw before reaching decoders, even with a hidden allowFailure", async (t) => {
	const provider = providerReturning("0x00022a");
	const decodeResult = t.mock.fn(() => 42);
	await assert.rejects(aggregateCalls(provider, [call]), GhostcallSubcallError);
	const original = { ...call, decodeResult, allowFailure: true };
	// Structural typing can hide an extra field without removing it at runtime.
	const erased: Omit<GhostcallDecodedCall<number>, "allowFailure"> = original;
	await assert.rejects(
		aggregateDecodedCalls(provider, [erased]),
		(error: unknown) => {
			assert.ok(error instanceof GhostcallSubcallError);
			assert.equal(error.index, 0);
			assert.equal(error.call, original);
			assert.equal(error.returnData, "0x2a");
			assert.equal(error.message, "ghostcall subcall 0 failed");
			assert.equal(error.cause, undefined);
			return true;
		},
	);
	assert.equal(decodeResult.mock.callCount(), 0);
});

test("decoder throws become GhostcallSubcallError with the call index and the thrown value as cause", async () => {
	const provider = providerReturning("0x00032a0005babe");
	// A decoder may throw any value, not only an Error.
	for (const thrown of [new RangeError("unexpected length"), "not an Error"]) {
		const throwing = {
			...call,
			decodeResult: (): never => {
				throw thrown;
			},
		} satisfies GhostcallDecodedCall<never>;
		await assert.rejects(
			aggregateDecodedCalls(provider, [
				{ ...call, decodeResult: (data: Hex) => data },
				throwing,
			]),
			(error: unknown) => {
				assert.ok(error instanceof GhostcallSubcallError);
				assert.equal(
					error.message,
					"ghostcall subcall 1 result could not be decoded",
				);
				assert.equal(error.index, 1);
				assert.equal(error.call, throwing);
				assert.equal(error.returnData, "0xbabe");
				assert.equal(error.cause, thrown);
				return true;
			},
		);
	}
});

test("the first failed or undecodable call is reported and later decoders do not run", async (t) => {
	const decode = t.mock.fn((data: Hex) => data);
	const reject = t.mock.fn((): never => {
		throw new Error("unexpected data");
	});
	const calls = [
		{ ...call, decodeResult: decode },
		{ ...call, decodeResult: reject },
		{ ...call, decodeResult: decode },
	];
	// Call 1 cannot be decoded and call 2 reverted: call 1 is reported.
	await assert.rejects(
		aggregateDecodedCalls(providerReturning("0x0003aa0003bb0002cc"), calls),
		/subcall 1 result could not be decoded/,
	);
	assert.equal(decode.mock.callCount(), 1);
	// Call 0 reverted: it is reported before any decoder runs.
	await assert.rejects(
		aggregateDecodedCalls(providerReturning("0x0002aa0003bb0003cc"), calls),
		/subcall 0 failed/,
	);
	assert.equal(decode.mock.callCount(), 1);
	assert.equal(reject.mock.callCount(), 1);
});

test("rejects non-hex provider responses and mismatched result counts", async () => {
	await assert.rejects(
		aggregateCalls(providerReturning(123), [call]),
		/eth_call result must be/,
	);
	for (const response of ["0x", "0x00010001"]) {
		await assert.rejects(
			aggregateCalls(providerReturning(response), [call]),
			/result entries for 1 calls/,
		);
	}
});
