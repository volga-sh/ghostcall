import { validate as isAddress } from "ox/Address";
import { size as hexSize, validate as isHex } from "ox/Hex";

import {
	type GhostcallAbiCall,
	type GhostcallAbiResult,
	prepareDecodedCalls,
} from "./abi.ts";
import { ghostcallInitcode } from "./generated/initcode.ts";

/**
 * The string has the `0x` prefix.
 * The SDK does a check at each wire-format boundary.
 */
type Hex = `0x${string}`;

/**
 * The call contains calldata for one target.
 * The encoder does not use the failure policy.
 */
type GhostcallCall = {
	to: Hex;
	/** The maximum calldata length is 65,535 bytes. The request stores a uint16 length. */
	data: Hex;
	/** If true, aggregateCalls returns entries with a failure status. The default value is false. */
	allowFailure?: boolean;
};

/** The decoder receives return data only if the call returns a success status. */
type GhostcallDecodedCall<TResult = unknown> = {
	to: Hex;
	/** The maximum calldata length is 65,535 bytes. The request stores a uint16 length. */
	data: Hex;
	decodeResult: (returnData: Hex, index: number) => TResult;
	abi?: never;
	functionName?: never;
	args?: never;
	allowFailure?: never;
};

/** Each call has one result. A call with a failure status stores its revert data in returnData. */
type GhostcallResult = { success: boolean; returnData: Hex };

type GhostcallDecodedInput = GhostcallAbiCall | GhostcallDecodedCall;

// Keep each result in its tuple position when the call types form a union.
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
	/** The full CREATE request with the initcode must not be larger than this limit. The default value is 49,152 bytes. */
	maxInitcodeBytes?: number;
};

type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	/** These options control the outer eth_call for the full batch. */
	ethCall?: {
		from?: Hex;
		gas?: bigint;
		/** Use a block number or a named tag. The default value is "latest". */
		blockTag?:
			| bigint
			| "latest"
			| "earliest"
			| "pending"
			| "safe"
			| "finalized";
	};
};

/**
 * The provider has an EIP-1193 request method.
 * A viem client or an ox transport can supply this method.
 */
type GhostcallProvider = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

/**
 * The error identifies a call with a failure status, its index, and its revert data.
 * The index starts at zero.
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

// Request entry:
//   [length: 2 bytes][target: 20 bytes][calldata: N bytes]
//   |<--------- 22-byte header ----->|
// The uint16 length uses big-endian byte order.
const callHeaderSize = 22;
const calldataLengthHexChars = 4;
const maxCalldataSize = 0xffff;
// Result entry:
//   [header: 2 bytes][return data: N bytes]
// Header bits:
//   [length: bits 15..1][success: bit 0]
// The header value is length * 2 + success.
const resultHeaderHexChars = 4;
const successFlag = 1;
// EIP-3860 gives the default limit for initcode size.
const defaultMaxInitcodeBytes = 0xc000;
// The three-byte initcode PUSH0, DUP1, RETURN returns no data.
const emptyBatchInitcode = "0x5f80f3" as const;

/**
 * Build data for a CREATE-style eth_call.
 * For a list with one or more calls, put the initcode before the call entries.
 * Each entry has a 22-byte header and calldata.
 * For an empty list, return the three-byte initcode `0x5f80f3`.
 * This initcode returns no data.
 * Send the request without a `to` address.
 * Throw TypeError for incorrect input.
 * Throw RangeError if the input is larger than a size limit.
 */
function encodeCalls(
	calls: readonly GhostcallCall[],
	{ maxInitcodeBytes = defaultMaxInitcodeBytes }: GhostcallEncodeOptions = {},
): Hex {
	let encodedData: Hex =
		calls.length === 0 ? emptyBatchInitcode : ghostcallInitcode;
	let totalEncodedSize = hexSize(encodedData);
	const sizeError = `encoded ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`;
	if (totalEncodedSize > maxInitcodeBytes) throw new RangeError(sizeError);

	// Use a loop to decrease the cost of string concatenation. Refer to benchmark:sdk.
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
 * Run the raw calls in sequence.
 * aggregateCalls throws GhostcallSubcallError for a failure status unless the entry sets allowFailure to true.
 * The SDK does not change provider errors.
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
 * Run ABI calls or raw calls with custom decoders.
 * Each result keeps the type of its tuple position.
 * aggregateDecodedCalls throws an error if a call returns a failure status.
 * The SDK does not change encoding or decoding errors.
 * The ABI decoder returns each address with its checksum.
 * This rule also includes addresses in tuples and arrays.
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

/**
 * Decode the result entries in sequence.
 * Each two-byte header stores the value `length * 2 + success`.
 * Reject incorrect hex and truncated data.
 */
function decodeResults(data: Hex): GhostcallResult[] {
	return decodeValidatedResults(assertHex(data, "data"));
}

/**
 * Send one eth_call and return one result for each call.
 * Do not use a failure policy.
 */
async function executeCalls(
	provider: GhostcallProvider,
	calls: readonly GhostcallCall[],
	options: GhostcallAggregateOptions = {},
): Promise<GhostcallResult[]> {
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

/** Parse the hex string only after the public API or the RPC boundary does a check of all its bytes. */
function decodeValidatedResults(data: Hex): GhostcallResult[] {
	const results: GhostcallResult[] = [];
	let cursor = 2;
	while (cursor < data.length) {
		const start = cursor + resultHeaderHexChars;
		const header = Number.parseInt(data.slice(cursor, start), 16);
		cursor = start + (header >> 1) * 2;
		// If the header is too short, the cursor is after the data.
		// The same check finds a header or a body that is too short.
		if (cursor > data.length) {
			throw new TypeError("Truncated ghostcall response");
		}
		const success = (header & successFlag) !== 0;
		results.push({ success, returnData: `0x${data.slice(start, cursor)}` });
	}
	return results;
}

// The types do not give a length of 20 bytes.
// The Yul program does not do a check of the target.
function assertAddress(value: string, label: string): Hex {
	if (!isAddress(value, { strict: false })) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
	return value;
}

function assertHex(value: unknown, label: string): Hex {
	// ox does a check of the prefix and the digits.
	// The wire format uses only whole bytes.
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
