import { ghostcallInitcode } from "./generated/initcode.ts";

/**
 * Hex-encoded binary data prefixed with `0x`.
 *
 * Ghostcall request and response data is represented as raw hex strings. The
 * SDK does not accept byte arrays or ABI fragments.
 */
type Hex = `0x${string}`;

/**
 * Hex-encoded RPC quantity prefixed with `0x`.
 */
type HexQuantity = `0x${string}`;

/**
 * Block reference accepted by the outer `eth_call`.
 */
type GhostcallBlockReference = string | number | bigint;

/**
 * One Ghostcall subcall entry.
 */
type GhostcallCall = {
	/**
	 * Target contract address to invoke.
	 */
	to: Hex;

	/**
	 * Hex-encoded call data to forward to {@link GhostcallCall.to}.
	 *
	 * The encoded payload is limited to `65535` bytes because Ghostcall stores each
	 * calldata length as a big-endian `uint16`.
	 */
	data: Hex;
};

/**
 * One Ghostcall aggregate subcall entry.
 *
 * The wire format does not include failure-policy bits. `allowFailure` is an SDK
 * policy applied after Ghostcall returns the packed result entries.
 */
type GhostcallAggregateCall = GhostcallCall & {
	/**
	 * Allows this subcall to return a failed result entry.
	 *
	 * Defaults to `false`, matching Multicall3's strict `aggregate3` behavior when
	 * a call does not explicitly opt into failure.
	 */
	allowFailure?: boolean;
};

/**
 * One Ghostcall subcall entry for decoded aggregate results.
 */
type GhostcallDecodedCall<TResult = unknown> = GhostcallCall & {
	/**
	 * Decodes this call's successful return data.
	 *
	 * This is intentionally a caller-provided function so the SDK stays independent
	 * from ABI libraries while still letting callers plug in helpers such as
	 * `decodeFunctionResult` from viem or ox.
	 */
	decodeResult: GhostcallResultDecoder<TResult>;
};

/**
 * One successful Ghostcall result entry.
 */
type GhostcallSuccessResult = {
	/**
	 * Indicates whether the underlying EVM `CALL` returned successfully.
	 *
	 * A `true` value means the target call returned successfully.
	 */
	success: true;

	/**
	 * Raw return data produced by the target call.
	 */
	returnData: Hex;
};

/**
 * One failed Ghostcall result entry.
 */
type GhostcallFailedResult = {
	/**
	 * Indicates whether the underlying EVM `CALL` returned successfully.
	 *
	 * A `false` value means the target call reverted or otherwise failed, but the
	 * Ghostcall batch itself still completed successfully.
	 */
	success: false;

	/**
	 * Raw return data produced by the target call.
	 *
	 * For failed calls this contains revert data, if any. The SDK leaves higher-level
	 * ABI decoding and failure policy to the caller.
	 */
	returnData: Hex;
};

/**
 * One decoded Ghostcall result entry.
 */
type GhostcallResult = GhostcallSuccessResult | GhostcallFailedResult;

/**
 * Function used by {@link aggregateCalls} to turn raw successful return data into
 * a caller-chosen value.
 */
type GhostcallResultDecoder<TResult> = (
	returnData: Hex,
	entry: GhostcallSuccessResult,
	index: number,
) => TResult;

/**
 * Error thrown when a strict Ghostcall batch encounters a failed subcall.
 */
class GhostcallSubcallError extends Error {
	readonly index: number;
	readonly call: GhostcallAggregateCall;
	readonly result: GhostcallFailedResult;

	constructor(
		index: number,
		call: GhostcallAggregateCall,
		result: GhostcallFailedResult,
	) {
		super(`Ghostcall subcall ${index} failed`);
		this.name = "GhostcallSubcallError";
		this.index = index;
		this.call = call;
		this.result = result;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

type GhostcallDecodedResults<TCalls extends readonly GhostcallDecodedCall[]> = {
	-readonly [Index in keyof TCalls]: TCalls[Index] extends {
		decodeResult: GhostcallResultDecoder<infer TResult>;
	}
		? TResult
		: never;
};

type GhostcallEncodeOptions = {
	/**
	 * Maximum allowed CREATE initcode size in bytes.
	 *
	 * This applies to the full request `data`, including bundled Ghostcall
	 * initcode and every encoded subcall entry.
	 *
	 * Defaults to Ethereum's EIP-3860 limit of `49,152` bytes.
	 */
	maxInitcodeBytes?: number;
};

type GhostcallEthCallOptions = {
	/**
	 * Optional `from` address for the outer `eth_call`.
	 */
	from?: Hex;

	/**
	 * Optional gas limit for the outer `eth_call`.
	 */
	gas?: HexQuantity;

	/**
	 * Optional block tag, hex quantity, or block number for the outer `eth_call`.
	 *
	 * Decimal strings, numbers, and bigints are normalized to hex quantities.
	 * Defaults to `latest`.
	 */
	blockTag?: GhostcallBlockReference;
};

type GhostcallAggregateOptions = GhostcallEncodeOptions & {
	/**
	 * Optional outer `eth_call` controls shared by {@link aggregateCalls} and
	 * {@link aggregateDecodedCalls}.
	 */
	ethCall?: GhostcallEthCallOptions;
};

/**
 * Minimal EIP-1193 provider shape used by the SDK.
 */
type EIP1193ProviderWithRequestFn = {
	request(args: { method: string; params?: unknown }): Promise<unknown>;
};

const addressHexLength = 40;
const encodedHeaderHexLength = 4;
const maxCalldataSize = 0xffff;
const encodedCallHeaderSize = 0x16;
const defaultMaxCreateInitcodeSize = 0xc000;
const successFlagMask = 0x8000;
const returnDataLengthMask = 0x7fff;
const bundledInitcodeSize = byteLength(ghostcallInitcode);

/**
 * Encodes a list of contract calls into the full CREATE-style `eth_call` payload
 * expected by Ghostcall.
 *
 * The returned hex string already includes the bundled Ghostcall initcode followed
 * by the compact binary payload for each subcall, so callers can pass it directly
 * as the `data` field of an `eth_call` request without supplying a `to` address.
 * Each encoded subcall entry uses the compact layout `[len(2)][target(20)][data]`.
 * The bundled initcode assumes appended bytes follow this exact shape; this
 * function is the supported boundary for producing well-formed Ghostcall payloads.
 *
 * @param calls - Ordered list of subcalls to execute. Each entry becomes one
 *                Ghostcall payload segment in the same order it appears here.
 * @param options - Optional encoding controls.
 *
 * @returns Full CREATE payload consisting of the bundled Ghostcall initcode plus
 *          the encoded call list.
 *
 * @throws {TypeError} If any call address or calldata value is not valid hex.
 * @throws {RangeError} If any call data exceeds the protocol `uint16` length limit
 *                      or if the full encoded CREATE payload would exceed the
 *                      configured initcode size limit.
 *
 * @example
 * const data = encodeCalls([
 *   {
 *     // USDC on Ethereum mainnet: balanceOf(Binance 14)
 *     to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *     data: "0x70a0823100000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
 *   },
 *   {
 *     // WETH9 on Ethereum mainnet: totalSupply()
 *     to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
 *     data: "0x18160ddd",
 *   },
 * ]);
 *
 * // Later:
 * // provider.request({ method: "eth_call", params: [{ data }, "latest"] })
 */
function encodeCalls(
	calls: readonly GhostcallCall[],
	options: GhostcallEncodeOptions = {},
): Hex {
	const encodedParts = [ghostcallInitcode.slice(2)];
	const maxInitcodeBytes = resolveMaxInitcodeBytes(options.maxInitcodeBytes);
	let totalEncodedSize = bundledInitcodeSize;

	if (totalEncodedSize > maxInitcodeBytes) {
		throw new RangeError(
			`encoded Ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`,
		);
	}

	for (const [index, call] of calls.entries()) {
		assertAddress(call.to, `calls[${index}].to`);
		const calldata = assertHex(call.data, `calls[${index}].data`);
		const calldataSize = byteLength(calldata);

		if (calldataSize > maxCalldataSize) {
			throw new RangeError(
				`calls[${index}].data exceeds the ${maxCalldataSize}-byte calldata limit`,
			);
		}

		totalEncodedSize += encodedCallHeaderSize + calldataSize;
		if (totalEncodedSize > maxInitcodeBytes) {
			throw new RangeError(
				`encoded Ghostcall initcode exceeds the ${maxInitcodeBytes}-byte CREATE initcode limit`,
			);
		}

		encodedParts.push(calldataSize.toString(16).padStart(4, "0"));
		encodedParts.push(call.to.slice(2));
		encodedParts.push(calldata.slice(2));
	}

	return `0x${encodedParts.join("")}` as Hex;
}

/**
 * Sends a Ghostcall batch with a CREATE-style `eth_call` and decodes the result.
 *
 * This is the provider-facing counterpart to {@link encodeCalls} and
 * {@link decodeResults}. It sends the bundled Ghostcall initcode as the `data`
 * field of `eth_call` without a `to` address, then returns raw result entries
 * in the same order as the input calls. Request bytes are built through
 * {@link encodeCalls}, so SDK callers get the supported payload validation before
 * the RPC request is sent.
 *
 * By default, any failed subcall makes this method reject. Set
 * `allowFailure: true` on a call to receive that failed entry in the returned
 * results instead. Use {@link aggregateDecodedCalls} when you want a strict batch
 * that returns decoded values directly. Use `options.ethCall` to forward `from`,
 * `gas`, or `blockTag` to the outer `eth_call`.
 *
 * @param provider - EIP-1193-compatible provider with a `request` method.
 * @param calls - Ordered list of subcalls to execute.
 * @param options - Optional outer call and initcode controls.
 *
 * @returns Ordered Ghostcall result entries.
 *
 * @throws {TypeError} If inputs are not valid Ghostcall call entries or if the
 *                     provider returns a non-hex `eth_call` result.
 * @throws {RangeError} If the encoded CREATE payload exceeds protocol or the
 *                      configured CREATE initcode ceiling.
 * @throws {GhostcallSubcallError} If a subcall fails without `allowFailure: true`.
 * @throws {Error} If the response entry count does not match the request entry count.
 *
 * @example
 * const results = await aggregateCalls(provider, [
 *   {
 *     // USDC on Ethereum mainnet: balanceOf(Binance 14)
 *     to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *     data: "0x70a0823100000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
 *   },
 *   {
 *     // WETH9 on Ethereum mainnet: totalSupply()
 *     to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
 *     data: "0x18160ddd",
 *   },
 * ]);
 */
async function aggregateCalls(
	provider: EIP1193ProviderWithRequestFn,
	calls: readonly GhostcallAggregateCall[],
	options?: GhostcallAggregateOptions,
): Promise<GhostcallResult[]> {
	const resolvedOptions = options ?? {};
	const data = encodeCalls(calls, resolvedOptions);
	const ethCall = { data } as { data: Hex; from?: Hex; gas?: HexQuantity };
	const blockTag = normalizeBlockTag(
		resolvedOptions.ethCall?.blockTag ?? "latest",
		"options.ethCall.blockTag",
	);

	if (resolvedOptions.ethCall?.from !== undefined) {
		assertAddress(resolvedOptions.ethCall.from, "options.ethCall.from");
		ethCall.from = resolvedOptions.ethCall.from;
	}

	if (resolvedOptions.ethCall?.gas !== undefined) {
		ethCall.gas = assertHexQuantity(
			resolvedOptions.ethCall.gas,
			"options.ethCall.gas",
		);
	}

	const result = await provider.request({
		method: "eth_call",
		params: [ethCall, blockTag],
	});
	const entries = decodeResults(assertHex(result, "eth_call result"));

	if (entries.length !== calls.length) {
		throw new Error(
			`Ghostcall returned ${entries.length} result entries for ${calls.length} calls`,
		);
	}

	for (const [index, entry] of entries.entries()) {
		const call = calls[index] as GhostcallAggregateCall;
		if (!entry.success && call.allowFailure !== true) {
			throw new GhostcallSubcallError(index, call, entry);
		}
	}

	return entries;
}

/**
 * Sends a strict Ghostcall batch and decodes each successful result entry.
 *
 * This is the decoded counterpart to {@link aggregateCalls}. It sends the bundled
 * Ghostcall initcode as the `data` field of `eth_call` without a `to` address,
 * then runs each call's `decodeResult` callback over the successful return data in
 * the same order as the input calls.
 *
 * `aggregateDecodedCalls` is always strict. Its TypeScript input shape requires a
 * `decodeResult` callback on every call and does not accept `allowFailure`.
 * Any failed subcall rejects with {@link GhostcallSubcallError}. Use
 * {@link aggregateCalls} if you need raw failed entries. Use `options.ethCall`
 * to forward `from`, `gas`, or `blockTag` to the outer `eth_call`.
 *
 * @param provider - EIP-1193-compatible provider with a `request` method.
 * @param calls - Ordered list of strict decoded subcalls to execute.
 * @param options - Optional outer call and initcode controls.
 *
 * @returns Ordered list of decoded values.
 *
 * @throws {TypeError} If inputs are not valid Ghostcall call entries or if the
 *                     provider returns a non-hex `eth_call` result.
 * @throws {RangeError} If the encoded CREATE payload exceeds protocol or the
 *                      configured CREATE initcode ceiling.
 * @throws {GhostcallSubcallError} If any subcall fails.
 * @throws {Error} If the response entry count does not match the request entry count.
 *
 * @example
 * const erc20Abi = parseAbi([
 *   "function balanceOf(address account) view returns (uint256)",
 * ]);
 * const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
 * const owner = "0x28C6c06298d514Db089934071355E5743bf21d60";
 *
 * const [balance] = await aggregateDecodedCalls(provider, [
 *   {
 *     to: usdc,
 *     data: "0x70a0823100000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
 *     decodeResult: (returnData) => decodeFunctionResult({
 *       abi: erc20Abi,
 *       functionName: "balanceOf",
 *       data: returnData,
 *     }),
 *   },
 * ]);
 */
async function aggregateDecodedCalls<
	const TCalls extends readonly GhostcallDecodedCall<unknown>[],
>(
	provider: EIP1193ProviderWithRequestFn,
	calls: TCalls,
	options?: GhostcallAggregateOptions,
): Promise<GhostcallDecodedResults<TCalls>> {
	const entries = await aggregateCalls(provider, calls, options);

	return entries.map((entry, index) => {
		const call = calls[index] as TCalls[number];
		const successEntry = entry as GhostcallSuccessResult;
		return call.decodeResult(successEntry.returnData, successEntry, index);
	}) as GhostcallDecodedResults<TCalls>;
}

/**
 * Decodes the packed result blob returned by Ghostcall.
 *
 * Each decoded entry corresponds to exactly one subcall in the original batch and
 * preserves the original ordering. The SDK intentionally returns raw result bytes
 * rather than ABI-decoding them so higher-level callers can apply their own
 * decoding and failure policy.
 *
 * @param data - Raw bytes returned by Ghostcall, typically the direct result of a
 *               CREATE-style `eth_call`.
 *
 * @returns Ordered list of decoded Ghostcall result entries. Returns an empty
 *          array for `0x`.
 *
 * @throws {TypeError} If the provided data is not valid hex, if a result header is
 *                     truncated, or if an entry body is shorter than advertised.
 *
 * @example
 * const results = decodeResults("0x8002cafe0004deadbeef");
 *
 * console.log(results);
 * // [
 * //   { success: true, returnData: "0xcafe" },
 * //   { success: false, returnData: "0xdeadbeef" }
 * // ]
 */
function decodeResults(data: Hex): GhostcallResult[] {
	const normalizedData = assertHex(data, "data");

	if (normalizedData === "0x") {
		return [];
	}

	const results: GhostcallResult[] = [];
	const encodedData = normalizedData.slice(2);
	let cursor = 0;

	while (cursor < encodedData.length) {
		if (cursor + encodedHeaderHexLength > encodedData.length) {
			throw new TypeError("Truncated Ghostcall response header");
		}

		const header = Number.parseInt(
			encodedData.slice(cursor, cursor + encodedHeaderHexLength),
			16,
		);
		const success = (header & successFlagMask) !== 0;
		const returnDataSize = header & returnDataLengthMask;
		const nextCursor = cursor + encodedHeaderHexLength;
		const returnDataEnd = nextCursor + returnDataSize * 2;

		if (returnDataEnd > encodedData.length) {
			throw new TypeError("Truncated Ghostcall response body");
		}

		results.push({
			success,
			returnData: `0x${encodedData.slice(nextCursor, returnDataEnd)}` as Hex,
		});

		cursor = returnDataEnd;
	}

	return results;
}

/**
 * Validates that a value is a canonical 20-byte hex address.
 *
 * @param value - Unknown input to validate.
 * @param label - Field name used in thrown error messages.
 *
 * @throws {TypeError} If the value is not valid `0x`-prefixed hex or is not
 *                     exactly 20 bytes long.
 *
 * @internal
 */
function assertAddress(value: unknown, label: string): asserts value is Hex {
	const normalizedValue = assertHex(value, label);
	if (normalizedValue.length !== addressHexLength + 2) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
}

/**
 * Validates that a value is an even-length `0x`-prefixed hex string.
 *
 * @param value - Unknown input to validate.
 * @param label - Field name used in thrown error messages.
 *
 * @returns The validated value narrowed to {@link Hex}.
 *
 * @throws {TypeError} If the value is not a string, lacks the `0x` prefix, has an
 *                     odd number of hex characters, or contains non-hex digits.
 *
 * @internal
 */
function assertHex(value: unknown, label: string): Hex {
	if (typeof value !== "string") {
		throw new TypeError(`${label} must be a hex string`);
	}

	if (!value.startsWith("0x")) {
		throw new TypeError(`${label} must start with 0x`);
	}

	const rawValue = value.slice(2);
	if (rawValue.length % 2 !== 0) {
		throw new TypeError(`${label} must have an even number of hex characters`);
	}

	if (!/^[0-9a-fA-F]*$/.test(rawValue)) {
		throw new TypeError(`${label} must contain only hexadecimal characters`);
	}

	return value as Hex;
}

/**
 * Validates that a value is an RPC hex quantity.
 *
 * @param value - Unknown input to validate.
 * @param label - Field name used in thrown error messages.
 * @returns The validated value narrowed to {@link HexQuantity}.
 * @throws {TypeError} If the value is not a valid `0x`-prefixed quantity.
 *
 * @internal
 */
function assertHexQuantity(value: unknown, label: string): HexQuantity {
	if (typeof value !== "string") {
		throw new TypeError(`${label} must be a hex quantity string`);
	}

	if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
		throw new TypeError(`${label} must be a 0x-prefixed hex quantity`);
	}

	return value as HexQuantity;
}

/**
 * Normalizes a block reference into the RPC shape expected by `eth_call`.
 *
 * @param value - Block reference to normalize.
 * @param label - Field name used in thrown error messages.
 * @returns Normalized block reference.
 * @throws {TypeError} If the value is not a supported block reference.
 *
 * @internal
 */
function normalizeBlockTag(value: unknown, label: string): string {
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(
				`${label} must be a non-negative safe integer, bigint, or non-empty string`,
			);
		}

		return `0x${value.toString(16)}`;
	}

	if (typeof value === "bigint") {
		if (value < 0n) {
			throw new TypeError(
				`${label} must be a non-negative safe integer, bigint, or non-empty string`,
			);
		}

		return `0x${value.toString(16)}`;
	}

	if (typeof value !== "string" || value.length === 0) {
		throw new TypeError(
			`${label} must be a non-negative safe integer, bigint, or non-empty string`,
		);
	}

	if (/^-?[0-9]+$/.test(value)) {
		if (value.startsWith("-")) {
			throw new TypeError(
				`${label} must be a non-negative safe integer, bigint, or non-empty string`,
			);
		}

		return `0x${BigInt(value).toString(16)}`;
	}

	if (value.startsWith("0x") || value.startsWith("0X")) {
		return assertHexQuantity(`0x${value.slice(2)}`, label);
	}

	return value;
}

/**
 * Resolves the active CREATE initcode ceiling.
 *
 * @param value - Optional caller override.
 * @returns Active initcode ceiling in bytes.
 * @throws {TypeError} If the override is not a non-negative safe integer.
 *
 * @internal
 */
function resolveMaxInitcodeBytes(value: number | undefined): number {
	if (value === undefined) {
		return defaultMaxCreateInitcodeSize;
	}

	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(
			"options.maxInitcodeBytes must be a non-negative safe integer",
		);
	}

	return value;
}

/**
 * Returns the byte length of a validated hex string.
 *
 * @param value - Validated hex string.
 * @returns Number of bytes represented by {@link value}.
 *
 * @internal
 */
function byteLength(value: Hex): number {
	return (value.length - 2) / 2;
}

export type {
	EIP1193ProviderWithRequestFn,
	GhostcallAggregateCall,
	GhostcallAggregateOptions,
	GhostcallBlockReference,
	GhostcallCall,
	GhostcallDecodedCall,
	GhostcallDecodedResults,
	GhostcallEncodeOptions,
	GhostcallEthCallOptions,
	GhostcallFailedResult,
	GhostcallResult,
	GhostcallResultDecoder,
	GhostcallSuccessResult,
	Hex,
	HexQuantity,
};
export {
	aggregateCalls,
	aggregateDecodedCalls,
	decodeResults,
	encodeCalls,
	GhostcallSubcallError,
};
