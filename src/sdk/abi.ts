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
type FunctionsByName = Map<string, AbiFunction.AbiFunction | null>;
type SharedFunctions = Map<Abi, FunctionsByName>;

/**
 * Turn ABI calls into raw decoded calls that encode and decode with the same
 * resolved function. Raw decoded calls pass through unchanged.
 */
function prepareDecodedCalls(
	calls: readonly (GhostcallAbiCall | GhostcallDecodedCall)[],
): GhostcallDecodedCall[] {
	const sharedFunctions: SharedFunctions = new Map();
	return calls.map((call): GhostcallDecodedCall => {
		if (call.abi === undefined) return call;
		const args = call.args ?? [];
		const abiFunction = resolveAbiFunction(call, args, sharedFunctions);
		// ox encodes only the selector when args are missing, so reject that
		// before RPC; literal ABIs catch it in types, runtime-loaded ABIs cannot.
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

// Each ox lookup hashes the function signature, so a batch resolves each name
// once when it can. ox ignores args when exactly one ABI item has the name, of
// any item type. Other names resolve per call, by argument types.
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
