import { validate as isAddress } from "ox/Address";
import { size as hexSize, validate as isHex } from "ox/Hex";

import {
	type GhostcallAbiCall,
	type GhostcallAbiResult,
	prepareDecodedCalls,
} from "./abi.ts";
import { ghostcallInitcode } from "./generated/initcode.ts";

/** A 0x-prefixed string, validated at SDK wire boundaries. */
type Hex = `0x${string}`;

/** Raw calldata for one target. Encoding ignores the SDK-only failure policy. */
type GhostcallCall = {
	to: Hex;
	/** At most 65,535 bytes (the wire format stores a uint16 length). */
	data: Hex;
	/** Return failed entries from aggregateCalls instead of throwing. Default: false. */
	allowFailure?: boolean;
};

/** Raw calldata with a decoder that only receives successful return data. */
type GhostcallDecodedCall<TResult = unknown> = {
	to: Hex;
	/** At most 65,535 bytes (the wire format stores a uint16 length). */
	data: Hex;
	decodeResult: (returnData: Hex, index: number) => TResult;
	abi?: never;
	functionName?: never;
	args?: never;
	allowFailure?: never;
};

/** One subcall result. Failed calls carry their revert data in returnData. */
type GhostcallResult = { success: boolean; returnData: Hex };

type GhostcallDecodedInput = GhostcallAbiCall | GhostcallDecodedCall;

// Distribute over mixed call unions while retaining each tuple position.
type ValidatedDecodedCall<TCall extends GhostcallDecodedInput> =
	TCall extends GhostcallAbiCall ? GhostcallAbiCall<TCall["abi"]> : TCall;

type ValidatedDecodedCalls<TCalls extends readonly GhostcallDecodedInput[]> = {
	[Index in keyof TCalls]: ValidatedDecodedCall<TCalls[Index]>;
};

type DecodedResult<TCall extends GhostcallDecodedInput> =
	TCall extends GhostcallAbiCall
		? GhostcallAbiResult<TCall>
		: TCall extends GhostcallDecodedCall
			? ReturnType<TCall["decodeResult"]>
			: never;

type GhostcallDecodedResults<TCalls extends readonly GhostcallDecodedInput[]> =
	{
		-readonly [Index in keyof TCalls]: DecodedResult<TCalls[Index]>;
	};

type GhostcallEncodeOptions = {
	/** Full CREATE request ceiling, including bundled initcode. Default: 49,152 bytes. */
	maxInitcodeBytes?: number;
};

type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	/** Controls the outer eth_call, shared by the entire batch. */
	ethCall?: {
		from?: Hex;
		gas?: bigint;
		/** A block number or named tag. Default: "latest". */
		blockTag?:
			| bigint
			| "latest"
			| "earliest"
			| "pending"
			| "safe"
			| "finalized";
	};
};

/** A provider with an EIP-1193-style request method, such as a viem client or ox transport. */
type GhostcallProvider = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

/** A disallowed failure, with its zero-based index, executed call, and revert data. */
class GhostcallSubcallError extends Error {
	readonly index: number;
	readonly call: GhostcallCall;
	readonly returnData: Hex;

	constructor(index: number, call: GhostcallCall, returnData: Hex) {
		super(`ghostcall subcall ${index} failed`);
		this.name = "GhostcallSubcallError";
		this.index = index;
		this.call = call;
		this.returnData = returnData;
	}
}

// Request entries: [uint16 calldata length][20-byte target][calldata].
const callHeaderSize = 22;
const calldataLengthHexChars = 4;
const maxCalldataSize = 0xffff;
// Result entries: [success bit | uint15 returndata length][returndata].
const resultHeaderHexChars = 4;
const successFlag = 0x8000;
const returnDataLengthMask = 0x7fff;
// EIP-3860 initcode limit.
const defaultMaxInitcodeBytes = 0xc000;
const bundledInitcodeSize = hexSize(ghostcallInitcode);

/**
 * Build CREATE-style eth_call data: initcode followed by [length (2)][target (20)][data].
 * Send without a `to` address. Invalid inputs throw TypeError; size limits throw RangeError.
 */
function encodeCalls(
	calls: readonly GhostcallCall[],
	{ maxInitcodeBytes = defaultMaxInitcodeBytes }: GhostcallEncodeOptions = {},
): Hex {
	if (!Number.isSafeInteger(maxInitcodeBytes) || maxInitcodeBytes < 0) {
		throw new TypeError(
			"options.maxInitcodeBytes must be a non-negative safe integer",
		);
	}
	let encodedData: Hex = ghostcallInitcode;
	let totalEncodedSize = bundledInitcodeSize;
	const sizeError = `encoded ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`;
	if (totalEncodedSize > maxInitcodeBytes) throw new RangeError(sizeError);

	let index = 0;
	for (const call of calls) {
		const to = assertAddress(call.to, `calls[${index}].to`);
		const calldata = assertHex(call.data, `calls[${index}].data`);
		const calldataSize = hexSize(calldata);
		if (calldataSize > maxCalldataSize) {
			throw new RangeError(
				`calls[${index}].data exceeds the ${maxCalldataSize}-byte calldata limit`,
			);
		}
		totalEncodedSize += callHeaderSize + calldataSize;
		if (totalEncodedSize > maxInitcodeBytes) throw new RangeError(sizeError);
		const header = calldataSize
			.toString(16)
			.padStart(calldataLengthHexChars, "0");
		encodedData = `${encodedData}${header}${to.slice(2)}${calldata.slice(2)}`;
		index += 1;
	}
	return encodedData;
}

/**
 * Execute a raw batch in order. Failed calls throw GhostcallSubcallError unless
 * their entry sets allowFailure. Provider errors pass through unchanged.
 */
async function aggregateCalls(
	provider: GhostcallProvider,
	calls: readonly GhostcallCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]> {
	const results = await executeCalls(provider, calls, options);
	let index = 0;
	for (const result of results) {
		const call = calls[index] as GhostcallCall;
		if (!result.success && call.allowFailure !== true) {
			throw new GhostcallSubcallError(index, call, result.returnData);
		}
		index += 1;
	}
	return results;
}

/**
 * Execute ABI-described calls or raw calls with custom decoders. Each tuple position
 * retains its result type. Any failed call throws; encoding/decoding errors pass through.
 * ABI-decoded addresses are checksummed, including addresses nested in tuples or arrays.
 */
async function aggregateDecodedCalls<
	const TCalls extends readonly GhostcallDecodedInput[],
>(
	provider: GhostcallProvider,
	calls: TCalls & NoInfer<ValidatedDecodedCalls<TCalls>>,
	options?: GhostcallAggregateOptions,
): Promise<GhostcallDecodedResults<TCalls>> {
	const preparedCalls = prepareDecodedCalls(calls);
	const results = await executeCalls(provider, preparedCalls, options);
	return results.map(({ success, returnData }, index) => {
		const call = preparedCalls[index] as GhostcallDecodedCall;
		if (!success) throw new GhostcallSubcallError(index, call, returnData);
		return call.decodeResult(returnData, index);
	}) as GhostcallDecodedResults<TCalls>;
}

/** Decode ordered [success bit | uint15 length][returndata] entries. Reject malformed data. */
function decodeResults(data: Hex): GhostcallResult[] {
	return decodeValidatedResults(assertHex(data, "data"));
}

/** Send one eth_call and return one result per call, without applying a failure policy. */
async function executeCalls(
	provider: GhostcallProvider,
	calls: readonly GhostcallCall[],
	options: GhostcallAggregateOptions = {},
): Promise<GhostcallResult[]> {
	const { from, gas, blockTag = "latest" } = options.ethCall ?? {};
	const ethCall: { data: Hex; from?: Hex; gas?: Hex } = {
		data: encodeCalls(calls, options),
	};
	if (from !== undefined) {
		ethCall.from = assertAddress(from, "options.ethCall.from");
	}
	if (gas !== undefined) {
		ethCall.gas = toQuantity(gas, "options.ethCall.gas");
	}

	const response = await provider.request({
		method: "eth_call",
		params: [
			ethCall,
			typeof blockTag === "bigint"
				? toQuantity(blockTag, "options.ethCall.blockTag")
				: blockTag,
		],
	});
	const results = decodeValidatedResults(
		assertHex(response, "eth_call result"),
	);
	if (results.length !== calls.length) {
		throw new Error(
			`ghostcall returned ${results.length} result entries for ${calls.length} calls`,
		);
	}
	return results;
}

/** Parse only after the public API or RPC boundary has validated the entire hex string. */
function decodeValidatedResults(data: Hex): GhostcallResult[] {
	const results: GhostcallResult[] = [];
	let cursor = 2;
	while (cursor < data.length) {
		if (cursor + resultHeaderHexChars > data.length) {
			throw new TypeError("Truncated ghostcall response header");
		}
		const header = Number.parseInt(
			data.slice(cursor, cursor + resultHeaderHexChars),
			16,
		);
		cursor += resultHeaderHexChars;
		const returnDataEnd = cursor + (header & returnDataLengthMask) * 2;
		if (returnDataEnd > data.length) {
			throw new TypeError("Truncated ghostcall response body");
		}
		results.push({
			success: (header & successFlag) !== 0,
			returnData: `0x${data.slice(cursor, returnDataEnd)}`,
		});
		cursor = returnDataEnd;
	}
	return results;
}

function assertAddress(value: unknown, label: string): Hex {
	if (typeof value !== "string" || !isAddress(value, { strict: false })) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
	return value;
}

function assertHex(value: unknown, label: string): Hex {
	// ox checks prefix/digits; the wire format additionally requires whole bytes.
	if (!isHex(value, { strict: true }) || value.length % 2 !== 0) {
		throw new TypeError(
			`${label} must be an even-length 0x-prefixed hex string`,
		);
	}
	return value;
}

// The type proves a bigint and named tags; only the sign needs a runtime check.
function toQuantity(value: bigint, label: string): Hex {
	if (value < 0n) throw new TypeError(`${label} must be non-negative`);
	return `0x${value.toString(16)}`;
}

export type {
	GhostcallAbiCall,
	GhostcallAggregateOptions,
	GhostcallCall,
	GhostcallDecodedCall,
	GhostcallEncodeOptions,
	GhostcallProvider,
	GhostcallResult,
	Hex,
};
export {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
};
