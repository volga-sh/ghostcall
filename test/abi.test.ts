import assert from "node:assert/strict";
import test from "node:test";
import { Abi, AbiFunction, AbiParameters } from "ox";
import { size as hexSize } from "ox/Hex";
import {
	aggregateDecodedCalls,
	encodeCalls,
	type GhostcallAbiCall,
	type GhostcallProvider,
	type GhostcallResult,
	GhostcallSubcallError,
	type Hex,
} from "../src/sdk/index.ts";

const to = "0x1111111111111111111111111111111111111111";
const abi = Abi.from([
	"function totalSupply() view returns (uint256)",
	"function balanceOf(address owner) view returns (uint256)",
	"function lookup(uint256 id) view returns (uint256)",
	"function lookup(address owner) view returns (uint256)",
	"event Transfer(address indexed from, address indexed to, uint256 amount)",
]);

/** Pack results as a ghostcall response of [uint15 length | success bit][returndata]. */
function packResults(...results: GhostcallResult[]): Hex {
	return `0x${results
		.map(({ success, returnData }) => {
			const header = hexSize(returnData) * 2 + Number(success);
			return `${header.toString(16).padStart(4, "0")}${returnData.slice(2)}`;
		})
		.join("")}`;
}

/** Pack successful return data as a ghostcall response. */
function successResponse(...returnData: Hex[]): Hex {
	return packResults(
		...returnData.map((data) => ({ success: true, returnData: data })),
	);
}

test("resolves overloads per call and mixes ABI results with custom decoders in order", async (t) => {
	const overloadedAbi = Abi.from([
		"function get(uint256 id) view returns (uint256)",
		"function get(address owner) view returns (address)",
		"function supply() view returns (uint256)",
	]);
	const getById = AbiFunction.fromAbi(overloadedAbi, "get", { args: [1n] });
	const getByOwner = AbiFunction.fromAbi(overloadedAbi, "get", { args: [to] });
	const supply = AbiFunction.fromAbi(overloadedAbi, "supply");
	const request = t.mock.fn<GhostcallProvider["request"]>(async () =>
		successResponse(
			AbiFunction.encodeResult(getById, 7n),
			AbiFunction.encodeResult(getByOwner, to),
			AbiFunction.encodeResult(getById, 8n),
			AbiFunction.encodeResult(supply, 9n),
			"0xff",
		),
	);
	assert.deepEqual(
		await aggregateDecodedCalls({ request }, [
			{ to, abi: overloadedAbi, functionName: "get", args: [1n] },
			{ to, abi: overloadedAbi, functionName: "get", args: [to] },
			{ to, abi: overloadedAbi, functionName: "get", args: [2n] },
			{ to, abi: overloadedAbi, functionName: "supply" },
			{ to, data: "0xaabb", decodeResult: (data) => data },
		]),
		[7n, to, 8n, 9n, "0xff"],
	);
	assert.deepEqual(request.mock.calls[0]?.arguments[0].params, [
		{
			data: encodeCalls([
				{ to, data: AbiFunction.encodeData(getById, [1n]) },
				{ to, data: AbiFunction.encodeData(getByOwner, [to]) },
				{ to, data: AbiFunction.encodeData(getById, [2n]) },
				{ to, data: AbiFunction.encodeData(supply) },
				{ to, data: "0xaabb" },
			]),
		},
		"latest",
	]);
});

test("resolves a function whose name an event or error shares, in any ABI order", async (t) => {
	// Among all item types, ox picks the first zero-input item for a call
	// without args and the last item whose inputs match otherwise.
	const sharedNameAbi = Abi.from([
		"event ping()",
		"function ping() view returns (uint256)",
		"function get(uint256 id) view returns (uint256)",
		"error get(uint256 id)",
	]);
	const ping = AbiFunction.from("function ping() view returns (uint256)");
	const get = AbiFunction.from(
		"function get(uint256 id) view returns (uint256)",
	);
	const request = t.mock.fn<GhostcallProvider["request"]>(async () =>
		successResponse(
			AbiFunction.encodeResult(ping, 7n),
			AbiFunction.encodeResult(get, 8n),
		),
	);
	assert.deepEqual(
		await aggregateDecodedCalls({ request }, [
			{ to, abi: sharedNameAbi, functionName: "ping" },
			{ to, abi: sharedNameAbi, functionName: "get", args: [1n] },
		]),
		[7n, 8n],
	);
	assert.deepEqual(request.mock.calls[0]?.arguments[0].params, [
		{
			data: encodeCalls([
				{ to, data: AbiFunction.encodeData(ping) },
				{ to, data: AbiFunction.encodeData(get, [1n]) },
			]),
		},
		"latest",
	]);
});

test("resolves a function name within its own ABI object", async () => {
	const uintAbi = Abi.from(["function value() view returns (uint256)"]);
	const boolAbi = Abi.from(["function value() view returns (bool)"]);
	const response = successResponse(
		AbiFunction.encodeResult(AbiFunction.fromAbi(uintAbi, "value"), 1n),
		AbiFunction.encodeResult(AbiFunction.fromAbi(boolAbi, "value"), true),
	);
	assert.deepEqual(
		await aggregateDecodedCalls({ request: async () => response }, [
			{ to, abi: uintAbi, functionName: "value" },
			{ to, abi: boolAbi, functionName: "value" },
		]),
		[1n, true],
	);
});

test("a broadly typed ABI resolves a function by its selector", async (t) => {
	const dynamicAbi: Abi.Abi = Abi.from([
		"error get(uint256 id)",
		"function get(uint256 id) view returns (uint256)",
	]);
	const get = AbiFunction.from(
		"function get(uint256 id) view returns (uint256)",
	);
	const request = t.mock.fn<GhostcallProvider["request"]>(async () =>
		successResponse(AbiFunction.encodeResult(get, 8n)),
	);
	const functionName = AbiFunction.getSelector(get);
	assert.deepEqual(
		await aggregateDecodedCalls({ request }, [
			{ to, abi: dynamicAbi, functionName, args: [1n] },
		]),
		[8n],
	);
	assert.deepEqual(request.mock.calls[0]?.arguments[0].params, [
		{ data: encodeCalls([{ to, data: AbiFunction.encodeData(get, [1n]) }]) },
		"latest",
	]);
});

test("checksums ABI-decoded addresses, including nested tuples and arrays", async () => {
	const positionsAbi = Abi.from([
		"function owner() view returns (address)",
		"function positions() view returns ((address owner, address[] delegates)[])",
	]);
	const owner = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
	const lowercase = owner.toLowerCase() as Hex;
	const response = successResponse(
		AbiFunction.encodeResult(
			AbiFunction.fromAbi(positionsAbi, "owner"),
			lowercase,
		),
		AbiFunction.encodeResult(AbiFunction.fromAbi(positionsAbi, "positions"), [
			{ owner: lowercase, delegates: [lowercase] },
		]),
	);
	assert.deepEqual(
		await aggregateDecodedCalls({ request: async () => response }, [
			{ to, abi: positionsAbi, functionName: "owner" },
			{ to, abi: positionsAbi, functionName: "positions" },
		]),
		[owner, [{ owner, delegates: [owner] }]],
	);
});

test("invalid dynamic ABI calls fail before RPC", async (t) => {
	const request = t.mock.fn(async () => "0x");
	const calls: GhostcallAbiCall[] = [
		{ to, abi, functionName: "missing" },
		{ to, abi, functionName: "Transfer", args: [to, to, 1n] },
		{ to, abi, functionName: "balanceOf" },
		{ to, abi, functionName: "balanceOf", args: ["0x1234"] },
		{ to, abi, functionName: "totalSupply", args: [1n] },
		// Not an address, and ox would encode it as lookup(uint256)(0x1234).
		{ to, abi, functionName: "lookup", args: ["0x1234"] },
	];
	for (const call of calls)
		await assert.rejects(aggregateDecodedCalls({ request }, [call]));
	// Resolving a repeated function once must not skip per-call argument checks.
	const balanceOf = { to, abi, functionName: "balanceOf", args: [to] } as const;
	for (const call of calls)
		await assert.rejects(aggregateDecodedCalls({ request }, [balanceOf, call]));
	assert.equal(request.mock.callCount(), 0);
});

test("ABI subcall failures expose the executed calldata and raw revert data", async () => {
	await assert.rejects(
		aggregateDecodedCalls({ request: async () => "0x0008deadbeef" }, [
			{ to, abi, functionName: "totalSupply" },
		]),
		(error: unknown) => {
			assert.ok(error instanceof GhostcallSubcallError);
			assert.equal(error.kind, "call");
			assert.equal(error.call.data, "0x18160ddd");
			assert.equal(error.returnData, "0xdeadbeef");
			return true;
		},
	);
});

test("ABI calls that allow failure return failed and undecodable calls as errors", async () => {
	const tokenAbi = Abi.from([
		"function symbol() view returns (string)",
		"function decimals() view returns (uint8)",
	]);
	const symbol = AbiFunction.fromAbi(tokenAbi, "symbol");
	const decimals = AbiFunction.fromAbi(tokenAbi, "decimals");
	// Some early tokens return symbol() as bytes32, which is not an ABI string.
	const bytes32Symbol: Hex = `0x${"4d4b52".padEnd(64, "0")}`;
	const response = packResults(
		{ success: true, returnData: AbiFunction.encodeResult(symbol, "GHOST") },
		{ success: false, returnData: "0xdeadbeef" },
		// A target without code succeeds with empty return data.
		{ success: true, returnData: "0x" },
		{ success: true, returnData: bytes32Symbol },
		{ success: true, returnData: AbiFunction.encodeResult(decimals, 18) },
	);
	const symbolCall = {
		to,
		abi: tokenAbi,
		functionName: "symbol",
		allowFailure: true,
	} as const;
	const [ghost, reverted, empty, bytes32, decimalsResult] =
		await aggregateDecodedCalls({ request: async () => response }, [
			symbolCall,
			symbolCall,
			symbolCall,
			symbolCall,
			{ to, abi: tokenAbi, functionName: "decimals" },
		]);
	assert.deepEqual(ghost, { success: true, result: "GHOST" });
	assert.ok(!reverted.success && !empty.success && !bytes32.success);
	assert.deepEqual(
		[reverted, empty, bytes32].map(({ error }) => [
			error.kind,
			error.index,
			error.call.data,
			error.returnData,
		]),
		[
			["call", 1, AbiFunction.encodeData(symbol), "0xdeadbeef"],
			["decode", 2, AbiFunction.encodeData(symbol), "0x"],
			["decode", 3, AbiFunction.encodeData(symbol), bytes32Symbol],
		],
	);
	assert.ok(empty.error.cause instanceof AbiParameters.ZeroDataError);
	assert.equal(decimalsResult, 18);
});
