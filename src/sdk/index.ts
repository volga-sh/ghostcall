import { validate as isAddress } from "ox/Address";
import { size as hexSize, validate as isHex } from "ox/Hex";

import {
	type GhostcallAbiCall,
	type GhostcallAbiResult,
	prepareDecodedCalls,
} from "./abi.ts";
import { ghostcallInitcode } from "./generated/initcode.ts";

/** A string that starts with "0x". The SDK does a check of this value at its wire boundaries. */
type Hex = `0x${string}`;

/** Raw calldata for one target. encodeCalls() does not use allowFailure. */
type GhostcallCall = {
	to: Hex;
	/** 65,535 bytes or less. The wire format keeps the length in a uint16. */
	data: Hex;
	/** If true and success is false, aggregateCalls() returns this result and does not throw. Default: false. */
	allowFailure?: boolean;
};

/** Raw calldata with a decoder. The decoder gets the return data only if success is true. */
type GhostcallDecodedCall<TResult = unknown> = {
	to: Hex;
	/** 65,535 bytes or less. The wire format keeps the length in a uint16. */
	data: Hex;
	decodeResult: (returnData: Hex, index: number) => TResult;
	abi?: never;
	functionName?: never;
	args?: never;
	allowFailure?: never;
};

/** The result of one call. If success is false, returnData contains the revert data. */
type GhostcallResult = { success: boolean; returnData: Hex };

type GhostcallDecodedInput = GhostcallAbiCall | GhostcallDecodedCall;

// The conditional type distributes over a union of call types. Each tuple position keeps its type.
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
	/** The maximum size of the full CREATE request, with the bundled initcode. Default: 49,152 bytes. */
	maxInitcodeBytes?: number;
};

type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	/** Settings for the outer eth_call. All calls in the batch use these settings. */
	ethCall?: {
		from?: Hex;
		gas?: bigint;
		/** A block number or a named tag. Default: "latest". */
		blockTag?:
			| bigint
			| "latest"
			| "earliest"
			| "pending"
			| "safe"
			| "finalized";
	};
};

/** A provider with an EIP-1193 request method, for example a viem client or an ox transport. */
type GhostcallProvider = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

/**
 * The SDK throws this error if success is false for a call and allowFailure is not true.
 * The error contains the zero-based index, the executed call, and the revert data.
 */
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

// A request entry. The entries follow the bundled initcode.
//
//   +-----------------+-----------+-----------+
//   | calldata length | target    | calldata  |
//   | uint16, 2 bytes | 20 bytes  | N bytes   |
//   +-----------------+-----------+-----------+
const callHeaderSize = 22;
const calldataLengthHexChars = 4;
const maxCalldataSize = 0xffff;
// A result entry. The header is a big-endian uint16:
// header = returndata length * 2 + success bit.
//
//   +-----------------------------+------------+
//   | header, 2 bytes             | returndata |
//   | bits 1-15: length (uint15)  | N bytes    |
//   | bit 0:     success bit      |            |
//   +-----------------------------+------------+
const resultHeaderHexChars = 4;
const successFlag = 1;
// The EIP-3860 initcode limit.
const defaultMaxInitcodeBytes = 0xc000;
const bundledInitcodeSize = hexSize(ghostcallInitcode);

/**
 * Makes the data for a CREATE-style eth_call: the initcode, then one
 * [length (2)][target (20)][data] entry for each call. Send it without a `to`
 * address. `calls` must contain one or more calls. Incorrect inputs throw
 * TypeError. An empty `calls` list and size limits throw RangeError.
 */
function encodeCalls(
	calls: readonly GhostcallCall[],
	{ maxInitcodeBytes = defaultMaxInitcodeBytes }: GhostcallEncodeOptions = {},
): Hex {
	// The program calls the first entry before it does the end check. Thus a
	// request must contain one or more entries.
	if (calls.length === 0) throw new RangeError("calls must not be empty");
	let encodedData: Hex = ghostcallInitcode;
	let totalEncodedSize = bundledInitcodeSize;
	const sizeError = `encoded ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`;
	if (totalEncodedSize > maxInitcodeBytes) throw new RangeError(sizeError);

	// A for...of loop makes the string concatenation fast. Refer to benchmark:sdk.
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
 * Executes a raw batch in order. If success is false for a call, the function
 * throws GhostcallSubcallError, but not if allowFailure is true for that call.
 * An empty batch returns [] and sends no request. The function does not change
 * provider errors.
 */
async function aggregateCalls(
	provider: GhostcallProvider,
	calls: readonly GhostcallCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]> {
	const results = await executeCalls(provider, calls, options);
	let index = 0;
	for (const { success, returnData } of results) {
		const call = calls[index] as GhostcallCall;
		if (!success && !call.allowFailure) {
			throw new GhostcallSubcallError(index, call, returnData);
		}
		index += 1;
	}
	return results;
}

/**
 * Executes ABI calls, or raw calls with custom decoders. Each tuple position
 * keeps its result type. If success is false for a call, the function throws
 * GhostcallSubcallError. An empty batch returns [] and sends no request. The
 * function does not change encoding or decoding errors. The ABI decoder returns
 * checksummed addresses, also in tuples and arrays.
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

/** Decodes the [header][returndata] result entries in order. Throws TypeError if the data is not a correct response. */
function decodeResults(data: Hex): GhostcallResult[] {
	return decodeValidatedResults(assertHex(data, "data"));
}

/** Sends one eth_call and returns one result for each call. It does not use allowFailure. */
async function executeCalls(
	provider: GhostcallProvider,
	calls: readonly GhostcallCall[],
	options: GhostcallAggregateOptions = {},
): Promise<GhostcallResult[]> {
	// The program must have one or more entries. An empty batch has no results.
	// Thus the SDK sends no request.
	if (calls.length === 0) return [];
	const { from, gas, blockTag = "latest" } = options.ethCall ?? {};
	const ethCall = {
		data: encodeCalls(calls, options),
		...(from !== undefined && {
			from: assertAddress(from, "options.ethCall.from"),
		}),
		...(gas !== undefined && { gas: toQuantity(gas) }),
	};
	const response = await provider.request({
		method: "eth_call",
		params: [
			ethCall,
			typeof blockTag === "bigint" ? toQuantity(blockTag) : blockTag,
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

/** Use this function only after a check of the full hex string at the public API or RPC boundary. */
function decodeValidatedResults(data: Hex): GhostcallResult[] {
	const results: GhostcallResult[] = [];
	let cursor = 2;
	while (cursor < data.length) {
		const start = cursor + resultHeaderHexChars;
		const header = Number.parseInt(data.slice(cursor, start), 16);
		// Bits 1-15 of the header contain the length. One byte is two hex characters.
		cursor = start + (header >> 1) * 2;
		// If the header is not complete, cursor is also after the end of the data.
		// Thus one check finds both errors.
		if (cursor > data.length) {
			throw new TypeError("Truncated ghostcall response");
		}
		const success = (header & successFlag) !== 0;
		results.push({ success, returnData: `0x${data.slice(start, cursor)}` });
	}
	return results;
}

// A type cannot show a 20-byte length. The Yul program does not do a check of call targets.
function assertAddress(value: string, label: string): Hex {
	if (!isAddress(value, { strict: false })) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
	return value;
}

function assertHex(value: unknown, label: string): Hex {
	// ox does a check of the prefix and the digits. The wire format uses only full
	// bytes. Thus the length must be even.
	if (!isHex(value, { strict: true }) || value.length % 2 !== 0) {
		throw new TypeError(
			`${label} must be an even-length 0x-prefixed hex string`,
		);
	}
	return value;
}

function toQuantity(value: bigint): Hex {
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
