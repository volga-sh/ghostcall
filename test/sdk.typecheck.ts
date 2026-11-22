import { Abi } from "ox";
import {
	aggregateDecodedCalls,
	type GhostcallAbiCall,
	type GhostcallCall,
	type GhostcallDecodedCall,
	type GhostcallDecodedResult,
	type GhostcallProvider,
	GhostcallSubcallError,
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

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

/** Fails to compile unless its type argument is `true`. */
function assertType<_T extends true>(): void {}

async function checkDecodedTypes(provider: GhostcallProvider): Promise<void> {
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
		{ to, data: "0x", decodeResult: (data, index) => data.length + index },
	]);
	assertType<
		Equal<
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
		>
	>();

	const calls = [
		{ to, abi, functionName: "balanceOf", args: [to] },
	] as const satisfies readonly GhostcallAbiCall<typeof abi>[];
	const reused = await aggregateDecodedCalls(provider, calls);
	assertType<Equal<typeof reused, [bigint]>>();
	const rawCalls = [
		{ to, data: "0x", decodeResult: (data) => data.length },
		{ to, data: "0x", decodeResult: (data) => data.toUpperCase() },
	] as const satisfies readonly GhostcallDecodedCall[];
	const rawResults = await aggregateDecodedCalls(provider, rawCalls);
	assertType<Equal<typeof rawResults, [number, string]>>();
	const array: GhostcallDecodedCall<number>[] = [
		{ to, data: "0x", decodeResult: (data) => data.length },
	];
	const arrayResults = await aggregateDecodedCalls(provider, array);
	assertType<Equal<typeof arrayResults, number[]>>();
	const abiArray: Extract<
		GhostcallAbiCall<typeof abi>,
		{ functionName: "balanceOf" }
	>[] = [{ to, abi, functionName: "balanceOf", args: [to] }];
	const abiArrayResults = await aggregateDecodedCalls(provider, abiArray);
	assertType<Equal<typeof abiArrayResults, bigint[]>>();
	const empty = await aggregateDecodedCalls(provider, []);
	assertType<Equal<typeof empty, []>>();
	const mixedArray: (GhostcallAbiCall | GhostcallDecodedCall)[] = [
		...calls,
		...array,
	];
	const mixedResults = await aggregateDecodedCalls(provider, mixedArray);
	assertType<Equal<typeof mixedResults, unknown[]>>();

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
}

async function checkAllowFailureTypes(
	provider: GhostcallProvider,
): Promise<void> {
	// Only entries that set allowFailure: true wrap their result.
	const results = await aggregateDecodedCalls(provider, [
		{ to, abi, functionName: "balanceOf", args: [to] },
		{ to, abi, functionName: "symbol", allowFailure: true },
		{ to, abi, functionName: "lookup", args: [to], allowFailure: true },
		{ to, abi, functionName: "decimals", allowFailure: false },
		{ to, data: "0x", decodeResult: (data) => data.length, allowFailure: true },
	]);
	assertType<
		Equal<
			typeof results,
			[
				bigint,
				GhostcallDecodedResult<string>,
				GhostcallDecodedResult<string>,
				number,
				GhostcallDecodedResult<number>,
			]
		>
	>();
	const [, symbol] = results;
	if (symbol.success) {
		assertType<Equal<typeof symbol.result, string>>();
	} else {
		assertType<Equal<typeof symbol.error, GhostcallSubcallError>>();
		// @ts-expect-error A failed entry has no decoded result.
		symbol.result;
	}

	const reused = [
		{ to, abi, functionName: "balanceOf", args: [to], allowFailure: true },
		{ to, abi, functionName: "totalSupply" },
	] as const satisfies readonly GhostcallAbiCall<typeof abi, boolean>[];
	const reusedResults = await aggregateDecodedCalls(provider, reused);
	assertType<
		Equal<typeof reusedResults, [GhostcallDecodedResult<bigint>, bigint]>
	>();
	const tokens: Hex[] = [to];
	const symbolCalls = tokens.map(
		(token) =>
			({ to: token, abi, functionName: "symbol", allowFailure: true }) as const,
	);
	const symbols = await aggregateDecodedCalls(provider, symbolCalls);
	assertType<Equal<typeof symbols, GhostcallDecodedResult<string>[]>>();
	const allowedArray: GhostcallDecodedCall<number, true>[] = [
		{ to, data: "0x", decodeResult: (data) => data.length, allowFailure: true },
	];
	const allowedResults = await aggregateDecodedCalls(provider, allowedArray);
	assertType<Equal<typeof allowedResults, GhostcallDecodedResult<number>[]>>();

	// A policy chosen at runtime types its result as either shape.
	const allowFailure = tokens.length > 1;
	const runtimePolicy = await aggregateDecodedCalls(provider, [
		{ to, abi, functionName: "totalSupply", allowFailure },
	]);
	assertType<
		Equal<typeof runtimePolicy, [bigint | GhostcallDecodedResult<bigint>]>
	>();
	const runtimeArray: GhostcallDecodedCall<number, boolean>[] = [];
	const runtimeArrayResults = await aggregateDecodedCalls(
		provider,
		runtimeArray,
	);
	assertType<
		Equal<
			typeof runtimeArrayResults,
			(number | GhostcallDecodedResult<number>)[]
		>
	>();

	// Each call in a union keeps its own policy.
	const mixedPolicies: (
		| GhostcallDecodedCall<number, true>
		| GhostcallDecodedCall<string>
	)[] = [];
	const mixedPolicyResults = await aggregateDecodedCalls(
		provider,
		mixedPolicies,
	);
	assertType<
		Equal<
			typeof mixedPolicyResults,
			(GhostcallDecodedResult<number> | string)[]
		>
	>();

	const flagged = {
		to,
		data: "0x",
		decodeResult: (data: Hex) => data.length,
		allowFailure: true,
	} as const;
	const flaggedResults = await aggregateDecodedCalls(provider, [flagged]);
	assertType<Equal<typeof flaggedResults, [GhostcallDecodedResult<number>]>>();
	// @ts-expect-error A call type that forbids failure cannot allow it.
	const strict: GhostcallDecodedCall<number>[] = [flagged];
	const flaggedAbi = {
		to,
		abi,
		functionName: "symbol",
		allowFailure: true,
	} as const;
	// @ts-expect-error The same holds for ABI calls.
	const strictAbi: GhostcallAbiCall<typeof abi> = flaggedAbi;
	const unflagged = { to, data: "0x", decodeResult: () => 1 } as const;
	// @ts-expect-error A call type that permits failure must set the flag.
	const permitted: GhostcallDecodedCall<number, true> = unflagged;
	void [strict, strictAbi, permitted];
}

async function checkSharedNames(provider: GhostcallProvider): Promise<void> {
	// An event or error that shares a function's name is not an overload of it.
	const abi = Abi.from([
		"event supply(uint256 amount)",
		"function supply() view returns (uint256)",
		"function lookup() view returns (uint8)",
		"function lookup(address owner) view returns (string)",
		"error lookup(bool flag)",
	]);
	const results = await aggregateDecodedCalls(provider, [
		{ to, abi, functionName: "supply" },
		{ to, abi, functionName: "lookup" },
		{ to, abi, functionName: "lookup", args: [to] },
	]);
	assertType<Equal<typeof results, [bigint, number, string]>>();
}

async function checkDynamicAbi(
	provider: GhostcallProvider,
	abi: Abi.Abi,
): Promise<void> {
	const results = await aggregateDecodedCalls(provider, [
		{ to, abi, functionName: "loadedAtRuntime", args: [1n] },
	]);
	assertType<Equal<typeof results, [unknown]>>();
}

function checkSubcallError(error: unknown, call: GhostcallCall): void {
	if (!(error instanceof GhostcallSubcallError)) return;
	assertType<Equal<typeof error.kind, "call" | "decode">>();
	const fields = { index: 0, call, returnData: "0x" } as const;
	// A decoder may throw undefined, so `cause` only needs to be present.
	new GhostcallSubcallError({ kind: "decode", ...fields, cause: undefined });
	// @ts-expect-error A decoding failure must carry the decoder's error.
	new GhostcallSubcallError({ kind: "decode", ...fields });
	// @ts-expect-error A failed call has no decoder error.
	new GhostcallSubcallError({ kind: "call", ...fields, cause: 1 });
}

void [
	checkDecodedTypes,
	checkAllowFailureTypes,
	checkSharedNames,
	checkDynamicAbi,
	checkSubcallError,
];
