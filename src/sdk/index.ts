import { validate as isAddress } from "ox/Address";
import { size as hexSize, validate as isHex } from "ox/Hex";

import {
	type GhostcallAbiCall,
	type GhostcallAbiResult,
	prepareAbiCall,
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

/** Raw calldata with a decoder that only receives successful results. */
type GhostcallDecodedCall<TResult = unknown> = GhostcallCall & {
	abi?: never;
	functionName?: never;
	args?: never;
	allowFailure?: never;
	decodeResult: (
		returnData: Hex,
		entry: Extract<GhostcallResult, { success: true }>,
		index: number,
	) => TResult;
};

/** Raw results retain input order and include revert data for failed calls. */
type GhostcallResult =
	| { success: true; returnData: Hex }
	| { success: false; returnData: Hex };

type GhostcallFailedResult = Extract<GhostcallResult, { success: false }>;
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
		/** Canonical RPC hex quantity. */
		gas?: Hex;
		/** Decimal block numbers are normalized to hex. Default: "latest". */
		blockTag?: string | number | bigint;
	};
};

type Provider = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

/** A disallowed failure, with its zero-based index, executed call, and revert data. */
class GhostcallSubcallError extends Error {
	readonly index: number;
	readonly call: GhostcallCall;
	readonly result: GhostcallFailedResult;

	constructor(
		index: number,
		call: GhostcallCall,
		result: GhostcallFailedResult,
	) {
		super(`Ghostcall subcall ${index} failed`);
		this.name = "GhostcallSubcallError";
		this.index = index;
		this.call = call;
		this.result = result;
	}
}

const encodedCallHeaderSize = 22;
const encodedHeaderHexLength = 4;
const maxCalldataSize = 0xffff;
const defaultMaxCreateInitcodeSize = 0xc000;
const successFlagMask = 0x8000;
const returnDataLengthMask = 0x7fff;
const bundledInitcodeSize = hexSize(ghostcallInitcode);

/**
 * Build CREATE-style eth_call data: initcode followed by [length (2)][target (20)][data].
 * Send without a `to` address. Invalid inputs throw TypeError; size limits throw RangeError.
 */
function encodeCalls(
	calls: readonly GhostcallCall[],
	{
		maxInitcodeBytes = defaultMaxCreateInitcodeSize,
	}: GhostcallEncodeOptions = {},
): Hex {
	if (!Number.isSafeInteger(maxInitcodeBytes) || maxInitcodeBytes < 0) {
		throw new TypeError(
			"options.maxInitcodeBytes must be a non-negative safe integer",
		);
	}
	let encodedData: Hex = ghostcallInitcode;
	let totalEncodedSize = bundledInitcodeSize;
	const sizeError = `encoded Ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`;
	if (totalEncodedSize > maxInitcodeBytes) throw new RangeError(sizeError);

	let index = 0;
	for (const call of calls) {
		assertAddress(call.to, `calls[${index}].to`);
		const calldata = assertHex(call.data, `calls[${index}].data`);
		const calldataSize = hexSize(calldata);
		if (calldataSize > maxCalldataSize) {
			throw new RangeError(
				`calls[${index}].data exceeds the ${maxCalldataSize}-byte calldata limit`,
			);
		}
		totalEncodedSize += encodedCallHeaderSize + calldataSize;
		if (totalEncodedSize > maxInitcodeBytes) throw new RangeError(sizeError);
		const header = calldataSize
			.toString(16)
			.padStart(encodedHeaderHexLength, "0");
		encodedData = `${encodedData}${header}${call.to.slice(2)}${calldata.slice(2)}`;
		index += 1;
	}
	return encodedData;
}

/**
 * Execute a raw batch in order. Failed calls throw GhostcallSubcallError unless
 * their entry sets allowFailure. Provider errors pass through unchanged.
 */
async function aggregateCalls(
	provider: Provider,
	calls: readonly GhostcallCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]> {
	const { from, gas, blockTag } = options?.ethCall ?? {};
	const ethCall: { data: Hex; from?: Hex; gas?: Hex } = {
		data: encodeCalls(calls, options ?? {}),
	};
	if (from !== undefined) {
		assertAddress(from, "options.ethCall.from");
		ethCall.from = from;
	}
	if (gas !== undefined)
		ethCall.gas = assertHexQuantity(gas, "options.ethCall.gas");

	const result = await provider.request({
		method: "eth_call",
		params: [ethCall, normalizeBlockTag(blockTag ?? "latest")],
	});
	const entries = decodeValidatedResults(assertHex(result, "eth_call result"));
	if (entries.length !== calls.length) {
		throw new Error(
			`Ghostcall returned ${entries.length} result entries for ${calls.length} calls`,
		);
	}
	let index = 0;
	for (const entry of entries) {
		const call = calls[index] as GhostcallCall;
		if (!entry.success && call.allowFailure !== true) {
			throw new GhostcallSubcallError(index, call, entry);
		}
		index += 1;
	}
	return entries;
}

/**
 * Execute ABI-described calls or raw calls with custom decoders. Each tuple position
 * retains its result type. Any failed call throws; encoding/decoding errors pass through.
 * ABI-decoded addresses are checksummed, including addresses nested in tuples or arrays.
 */
async function aggregateDecodedCalls<
	const TCalls extends readonly GhostcallDecodedInput[],
>(
	provider: Provider,
	calls: TCalls & NoInfer<ValidatedDecodedCalls<TCalls>>,
	options?: GhostcallAggregateOptions,
): Promise<GhostcallDecodedResults<TCalls>> {
	const preparedCalls = calls.map((call) =>
		call.abi === undefined ? call : prepareAbiCall(call),
	);
	const entries = await aggregateCalls(provider, preparedCalls, options);
	return entries.map((entry, index) => {
		// aggregateCalls has checked the count. Hidden allowFailure fields still cannot
		// bypass this guard and send failed returndata to a success-only decoder.
		const call = preparedCalls[index] as GhostcallDecodedCall;
		if (!entry.success) throw new GhostcallSubcallError(index, call, entry);
		return call.decodeResult(entry.returnData, entry, index);
	}) as GhostcallDecodedResults<TCalls>;
}

/** Decode ordered [success bit | uint15 length][returndata] entries. Reject malformed data. */
function decodeResults(data: Hex): GhostcallResult[] {
	return decodeValidatedResults(assertHex(data, "data"));
}

/** Parse only after the public API or RPC boundary has validated the entire hex string. */
function decodeValidatedResults(data: Hex): GhostcallResult[] {
	const results: GhostcallResult[] = [];
	let cursor = 2;
	while (cursor < data.length) {
		if (cursor + encodedHeaderHexLength > data.length) {
			throw new TypeError("Truncated Ghostcall response header");
		}
		const header = Number.parseInt(
			data.slice(cursor, cursor + encodedHeaderHexLength),
			16,
		);
		cursor += encodedHeaderHexLength;
		const returnDataEnd = cursor + (header & returnDataLengthMask) * 2;
		if (returnDataEnd > data.length) {
			throw new TypeError("Truncated Ghostcall response body");
		}
		results.push({
			success: (header & successFlagMask) !== 0,
			returnData: `0x${data.slice(cursor, returnDataEnd)}`,
		});
		cursor = returnDataEnd;
	}
	return results;
}

function assertAddress(value: unknown, label: string): asserts value is Hex {
	if (typeof value !== "string" || !isAddress(value, { strict: false })) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
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

function assertHexQuantity(value: unknown, label: string): Hex {
	if (
		typeof value !== "string" ||
		!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
	) {
		throw new TypeError(`${label} must be a 0x-prefixed hex quantity`);
	}
	return value as Hex;
}

function normalizeBlockTag(value: unknown): string {
	if (
		typeof value === "bigint" ||
		(typeof value === "number" && Number.isSafeInteger(value))
	) {
		if (value >= 0) return `0x${value.toString(16)}`;
	} else if (
		typeof value === "string" &&
		value.length > 0 &&
		!/^-\d+$/.test(value)
	) {
		if (/^\d+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
		return /^0x/i.test(value)
			? assertHexQuantity(`0x${value.slice(2)}`, "options.ethCall.blockTag")
			: value;
	}
	throw new TypeError(
		"options.ethCall.blockTag must be a non-negative safe integer, bigint, or non-empty string",
	);
}

export type {
	GhostcallAbiCall,
	GhostcallAggregateOptions,
	GhostcallCall,
	GhostcallDecodedCall,
	GhostcallEncodeOptions,
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
