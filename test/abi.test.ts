import assert from "node:assert/strict";
import test from "node:test";
import { Abi, AbiFunction } from "ox";
import {
	aggregateDecodedCalls,
	encodeCalls,
	type GhostcallAbiCall,
	GhostcallSubcallError,
} from "../src/sdk/index.ts";

const to = "0x1111111111111111111111111111111111111111";
const abi = Abi.from([
	"function totalSupply() view returns (uint256)",
	"function balanceOf(address owner) view returns (uint256)",
]);

test("prepares ABI calldata and mixes ABI results with custom decoders in order", async (t) => {
	const supply = AbiFunction.fromAbi(abi, "totalSupply");
	const request = t.mock.fn<
		Parameters<typeof aggregateDecodedCalls>[0]["request"]
	>(
		async () => `0x8020${AbiFunction.encodeResult(supply, 42n).slice(2)}8001ff`,
	);
	assert.deepEqual(
		await aggregateDecodedCalls({ request }, [
			{ to, abi, functionName: "totalSupply" },
			{ to, data: "0xaabb", decodeResult: (data) => data },
		]),
		[42n, "0xff"],
	);
	assert.deepEqual(request.mock.calls[0]?.arguments, [
		{
			method: "eth_call",
			params: [
				{
					data: encodeCalls([
						{ to, data: "0x18160ddd" },
						{ to, data: "0xaabb" },
					]),
				},
				"latest",
			],
		},
	]);
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
	assert.equal(request.mock.callCount(), 0);
});

test("ABI subcall failures expose the executed calldata and raw revert data", async () => {
	await assert.rejects(
		aggregateDecodedCalls({ request: async () => "0x0004deadbeef" }, [
			{ to, abi, functionName: "totalSupply" },
		]),
		(error: unknown) => {
			assert.ok(error instanceof GhostcallSubcallError);
			assert.equal(error.call.data, "0x18160ddd");
			assert.deepEqual(error.result, {
				success: false,
				returnData: "0xdeadbeef",
			});
			return true;
		},
	);
});
