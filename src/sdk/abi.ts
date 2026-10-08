import type { Abi } from "ox/Abi";
import * as AbiFunction from "ox/AbiFunction";
import type * as AbiItem from "ox/AbiItem";

import type { GhostcallDecodedCall, Hex } from "./index.ts";

// Distribute over functions so each name stays paired with its own arguments.
type FunctionCall<TFunction extends AbiFunction.AbiFunction> =
	TFunction extends AbiFunction.AbiFunction
		? {
				functionName: TFunction["name"];
			} & (TFunction["inputs"] extends readonly []
				? { args?: readonly [] }
				: { args: NonNullable<AbiFunction.encodeData.Args<TFunction>[0]> })
		: never;

/**
 * An ABI-described call. A literal ABI determines valid function names and args.
 * Use `as const` or an ABI parser to retain those literal types.
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

// Infer ox's argument constraint through its public options, then let ox choose
// the overload. This keeps our result types aligned with runtime resolution.
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

/** The decoded result of an ABI call, including argument-selected overloads. */
type GhostcallAbiResult<TCall extends GhostcallAbiCall> =
	AbiFunction.decodeResult.ReturnType<
		Extract<ResolvedFunction<TCall>, AbiFunction.AbiFunction>
	>;

/**
 * Functions resolved within one batch, keyed by ABI object and function name.
 * `null` marks a name that must be resolved per call from its arguments.
 */
type ResolvedAbiFunctions = Map<
	Abi,
	Map<string, AbiFunction.AbiFunction | null>
>;

/** Bind encoding and decoding to the same resolved ABI function. */
function prepareAbiCall(
	call: GhostcallAbiCall,
	resolvedFunctions: ResolvedAbiFunctions,
): GhostcallDecodedCall {
	const args = call.args ?? [];
	const abiFunction = resolveAbiFunction(call, args, resolvedFunctions);

	// ox permits selector-only encoding with no args. At this wire boundary,
	// missing arguments must fail before RPC, including for dynamically loaded ABIs.
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
}

// Each ox lookup hashes the function signature, so batches that repeat one
// function resolve it once. ox ignores args when exactly one ABI item has the
// name, of any item type. Other names resolve per call, by argument types.
function resolveAbiFunction(
	call: GhostcallAbiCall,
	args: readonly unknown[],
	resolvedFunctions: ResolvedAbiFunctions,
): AbiFunction.AbiFunction {
	let functions = resolvedFunctions.get(call.abi);
	if (functions === undefined) {
		functions = new Map();
		resolvedFunctions.set(call.abi, functions);
	}
	const resolved = functions.get(call.functionName);
	if (resolved) return resolved;

	const abiFunction = AbiFunction.fromAbi(call.abi, call.functionName, {
		args,
	});
	if (resolved === undefined) {
		const matches = call.abi.filter(
			(item) => "name" in item && item.name === call.functionName,
		);
		functions.set(call.functionName, matches.length === 1 ? abiFunction : null);
	}
	return abiFunction;
}

export type { GhostcallAbiCall, GhostcallAbiResult, ResolvedAbiFunctions };
export { prepareAbiCall };
