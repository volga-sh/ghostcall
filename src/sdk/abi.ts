import type { Abi } from "ox/Abi";
import * as AbiFunction from "ox/AbiFunction";
import type * as AbiItem from "ox/AbiItem";

import type { GhostcallDecodedCall, Hex } from "./index.ts";

// Keep the arguments with their function name when the function types form a union.
type FunctionCall<TFunction extends AbiFunction.AbiFunction> =
	TFunction extends AbiFunction.AbiFunction
		? {
				functionName: TFunction["name"];
			} & (TFunction["inputs"] extends readonly []
				? { args?: readonly [] }
				: { args: NonNullable<AbiFunction.encodeData.Args<TFunction>[0]> })
		: never;

/**
 * The ABI gives correct function names and arguments for this call.
 * Use `as const` or an ABI parser to keep literal types.
 */
type GhostcallAbiCall<TAbi extends Abi = Abi> = {
	to: Hex;
	abi: TAbi;
	data?: never;
	decodeResult?: never;
	allowFailure?: never;
} & (Abi extends TAbi
	? { functionName: string; args?: readonly unknown[] }
	: FunctionCall<Extract<TAbi[number], { type: "function" }>>);

type CallFunctionName<TCall extends GhostcallAbiCall> = TCall["functionName"] &
	AbiFunction.Name<TCall["abi"]>;

type CallArguments<TCall extends GhostcallAbiCall> = TCall extends {
	args: infer TArgs extends readonly unknown[];
}
	? TArgs
	: readonly [];

// Get the argument constraint from the public options in ox.
// Let ox select the overload.
// This keeps the result types equal to the types that ox selects at runtime.
type ResolvedFunction<TCall extends GhostcallAbiCall> =
	AbiItem.fromAbi.Options<
		TCall["abi"],
		CallFunctionName<TCall>
	> extends AbiItem.fromAbi.Options<
		TCall["abi"],
		CallFunctionName<TCall>,
		infer TArgs
	>
		? AbiItem.fromAbi.ReturnType<
				TCall["abi"],
				CallFunctionName<TCall>,
				Extract<CallArguments<TCall>, TArgs>,
				AbiFunction.AbiFunction
			>
		: never;

/** The decoded ABI result uses the overload that the arguments select. */
type GhostcallAbiResult<TCall extends GhostcallAbiCall> =
	AbiFunction.decodeResult.ReturnType<
		Extract<ResolvedFunction<TCall>, AbiFunction.AbiFunction>
	>;

// The cache is for one batch.
// The cache uses the ABI object and the function name as keys.
// For a null value, use the arguments to select a function for each call.
type FunctionsByName = Map<string, AbiFunction.AbiFunction | null>;
type SharedFunctions = Map<Abi, FunctionsByName>;

/**
 * Change ABI calls to calls with calldata and a decoder.
 * Use the same function to encode arguments and decode results.
 * Keep calls with custom decoders unchanged.
 */
function prepareDecodedCalls(
	calls: readonly (GhostcallAbiCall | GhostcallDecodedCall)[],
): GhostcallDecodedCall[] {
	const sharedFunctions: SharedFunctions = new Map();
	return calls.map((call): GhostcallDecodedCall => {
		if (call.abi === undefined) return call;
		const args = call.args ?? [];
		const abiFunction = resolveAbiFunction(call, args, sharedFunctions);
		// If arguments are missing, ox encodes only the selector.
		// Reject the incorrect argument count before the RPC request.
		// Literal ABI types prevent this error.
		// This check is necessary for ABIs from runtime data.
		if (args.length !== abiFunction.inputs.length) {
			throw new TypeError(
				`${call.functionName} expects ${abiFunction.inputs.length} arguments, received ${args.length}`,
			);
		}
		return {
			to: call.to,
			data: AbiFunction.encodeData(abiFunction, args),
			decodeResult: (returnData) =>
				AbiFunction.decodeResult(abiFunction, returnData),
		};
	});
}

// Each ox lookup hashes the function signature.
// Reuse one function for each name with only one ABI item.
// ox ignores arguments if exactly one ABI item has the name.
// This rule includes all item types.
// For other names, use the arguments to select a function for each call.
function resolveAbiFunction(
	call: GhostcallAbiCall,
	args: readonly unknown[],
	sharedFunctions: SharedFunctions,
): AbiFunction.AbiFunction {
	const functions: FunctionsByName = sharedFunctions.get(call.abi) ?? new Map();
	sharedFunctions.set(call.abi, functions);
	let shared = functions.get(call.functionName);
	if (shared === undefined) {
		const matches = call.abi.filter(
			(item) => "name" in item && item.name === call.functionName,
		);
		shared =
			matches.length === 1
				? AbiFunction.fromAbi(call.abi, call.functionName)
				: null;
		functions.set(call.functionName, shared);
	}
	return shared ?? AbiFunction.fromAbi(call.abi, call.functionName, { args });
}

export type { GhostcallAbiCall, GhostcallAbiResult };
export { prepareDecodedCalls };
