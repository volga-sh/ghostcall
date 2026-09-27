import { Abi } from "ox";
import {
	aggregateDecodedCalls,
	type GhostcallAbiCall,
	type GhostcallDecodedCall,
	type Hex,
} from "../src/sdk/index.ts";

const abi = Abi.from([
	"function totalSupply() view returns (uint256)",
	"function balanceOf(address owner) view returns (uint256)",
	"function decimals() view returns (uint8)",
	"function symbol() view returns (string)",
	"function pair() view returns (bool, uint256)",
	"function nothing()",
	"function positions((address owner, uint256 amount)[] items) view returns ((address owner, uint256 amount)[])",
	"function lookup(uint256 id) view returns (bool)",
	"function lookup(address owner) view returns (string)",
	"function lookup() view returns (uint256)",
	"event Transfer(address indexed from, address indexed to, uint256 amount)",
]);
const to = "0x1111111111111111111111111111111111111111";
type Provider = Parameters<typeof aggregateDecodedCalls>[0];

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

async function checkDecodedTypes(provider: Provider): Promise<void> {
	const results = await aggregateDecodedCalls(provider, [
		{ to, abi, functionName: "totalSupply" },
		{ to, abi, functionName: "balanceOf", args: [to] },
		{ to, abi, functionName: "decimals", args: [] },
		{ to, abi, functionName: "symbol" },
		{ to, abi, functionName: "pair" },
		{ to, abi, functionName: "nothing" },
		{ to, abi, functionName: "positions", args: [[{ owner: to, amount: 1n }]] },
		{ to, abi, functionName: "lookup", args: [1n] },
		{ to, abi, functionName: "lookup", args: [to] },
		{ to, abi, functionName: "lookup" },
		{ to, data: "0x", decodeResult: (data) => data.length },
	]);
	const exactResults: Equal<
		typeof results,
		[
			bigint,
			bigint,
			number,
			string,
			readonly [boolean, bigint],
			undefined,
			readonly { owner: Hex; amount: bigint }[],
			boolean,
			string,
			bigint,
			number,
		]
	> = true;

	const calls = [
		{ to, abi, functionName: "balanceOf", args: [to] },
	] as const satisfies readonly GhostcallAbiCall<typeof abi>[];
	const reused: [bigint] = await aggregateDecodedCalls(provider, calls);
	const rawCalls = [
		{ to, data: "0x", decodeResult: (data) => data.length },
		{ to, data: "0x", decodeResult: (data) => data.toUpperCase() },
	] as const satisfies readonly GhostcallDecodedCall[];
	const rawResults = await aggregateDecodedCalls(provider, rawCalls);
	const exactRaw: Equal<typeof rawResults, [number, string]> = true;
	const array: GhostcallDecodedCall<number>[] = [
		{ to, data: "0x", decodeResult: (data) => data.length },
	];
	const arrayResults: number[] = await aggregateDecodedCalls(provider, array);
	const abiArray: Extract<
		GhostcallAbiCall<typeof abi>,
		{ functionName: "balanceOf" }
	>[] = [{ to, abi, functionName: "balanceOf", args: [to] }];
	const abiArrayResults: bigint[] = await aggregateDecodedCalls(
		provider,
		abiArray,
	);
	const empty: [] = await aggregateDecodedCalls(provider, []);
	const mixedArray: (GhostcallAbiCall | GhostcallDecodedCall)[] = [
		...calls,
		...array,
	];
	const mixedResults = await aggregateDecodedCalls(provider, mixedArray);
	const exactMixed: Equal<typeof mixedResults, unknown[]> = true;
	void [
		exactResults,
		reused,
		exactRaw,
		arrayResults,
		abiArrayResults,
		empty,
		exactMixed,
	];

	const unknownName = { to, abi, functionName: "totalSuplpy" } as const;
	// @ts-expect-error The function name must exist in this ABI.
	aggregateDecodedCalls(provider, [unknownName]);
	const eventName = {
		to,
		abi,
		functionName: "Transfer",
		args: [to, to, 1n],
	} as const;
	// @ts-expect-error Events are not callable functions.
	aggregateDecodedCalls(provider, [eventName]);
	const missingArgs = { to, abi, functionName: "balanceOf" } as const;
	// @ts-expect-error balanceOf requires its address argument.
	aggregateDecodedCalls(provider, [missingArgs]);
	const wrongArgs = {
		to,
		abi,
		functionName: "balanceOf",
		args: [123n],
	} as const;
	// @ts-expect-error balanceOf accepts an address, not a bigint.
	aggregateDecodedCalls(provider, [wrongArgs]);
	const extraArgs = {
		to,
		abi,
		functionName: "totalSupply",
		args: [to],
	} as const;
	// @ts-expect-error totalSupply has no arguments.
	aggregateDecodedCalls(provider, [extraArgs]);
	const wrongOverload = {
		to,
		abi,
		functionName: "lookup",
		args: [true],
	} as const;
	// @ts-expect-error No lookup overload accepts a boolean.
	aggregateDecodedCalls(provider, [wrongOverload]);
	const invalidTuple = {
		to,
		abi,
		functionName: "positions",
		args: [[{ owner: to, amount: "1" }]],
	} as const;
	// @ts-expect-error Nested tuple fields retain their ABI types.
	aggregateDecodedCalls(provider, [invalidTuple]);
	const mixedFields = {
		to,
		abi,
		functionName: "totalSupply",
		data: "0x",
	} as const;
	// @ts-expect-error A call cannot specify both an ABI function and raw calldata.
	aggregateDecodedCalls(provider, [mixedFields]);
	const mixedDecoder = {
		to,
		abi,
		functionName: "totalSupply",
		decodeResult: () => 1,
	} as const;
	// @ts-expect-error The ABI determines the decoder for ABI calls.
	aggregateDecodedCalls(provider, [mixedDecoder]);
	const missingDecoder = { to, data: "0x" } as const;
	// @ts-expect-error Decoded raw calls require a decoder.
	aggregateDecodedCalls(provider, [missingDecoder]);
	const failureAllowed = {
		to,
		data: "0x",
		decodeResult: () => 1,
		allowFailure: true,
	} as const;
	// @ts-expect-error Reused objects cannot permit failure in the decoded API.
	aggregateDecodedCalls(provider, [failureAllowed]);
}

async function checkDynamicAbi(
	provider: Provider,
	abi: Abi.Abi,
): Promise<void> {
	const results = await aggregateDecodedCalls(provider, [
		{ to, abi, functionName: "loadedAtRuntime", args: [1n] },
	]);
	const dynamicResult: Equal<typeof results, [unknown]> = true;
	void dynamicResult;
}

void [checkDecodedTypes, checkDynamicAbi];
