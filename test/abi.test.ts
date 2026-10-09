import assert from "node:assert/strict";
import test from "node:test";
import { Abi, AbiFunction } from "ox";
import { size as hexSize } from "ox/Hex";
import {
	aggregateDecodedCalls,
	encodeCalls,
	type GhostcallAbiCall,
	type GhostcallProvider,
	GhostcallSubcallError,
	type Hex,
} from "../src/sdk/index.ts";

const to = "0x1111111111111111111111111111111111111111";
const abi = Abi.from([
	"function totalSupply() view returns (uint256)",
	"function balanceOf(address owner) view returns (uint256)",
]);

/** Encode return data with a success bit in the ghostcall response. */
function successResponse(...returnData: Hex[]): Hex {
	return `0x${returnData
		.map(
			(data) =>
				`${(hexSize(data) * 2 + 1).toString(16).padStart(4, "0")}${data.slice(2)}`,
		)
		.join("")}`;
}

test("resolves overloads per call and mixes ABI results with custom decoders in order", async (t) => {
	const overloadedAbi = Abi.from([
		"function get(uint256 id) view returns (uint256)",
		"function get(address owner) view returns (address)",
		"event supply(uint256 amount)",
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
		{ to, abi, functionName: "balanceOf" },
		{ to, abi, functionName: "balanceOf", args: ["0x1234"] },
		{ to, abi, functionName: "totalSupply", args: [1n] },
	];
	for (const call of calls)
		await assert.rejects(aggregateDecodedCalls({ request }, [call]));
	// Do an argument check for each call when calls share the same function.
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
			assert.equal(error.call.data, "0x18160ddd");
			assert.equal(error.returnData, "0xdeadbeef");
			return true;
		},
	);
});
