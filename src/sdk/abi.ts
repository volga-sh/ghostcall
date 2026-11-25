import type { Abi } from "ox/Abi";
import * as AbiFunction from "ox/AbiFunction";
import type * as AbiItem from "ox/AbiItem";

import type { GhostcallDecodedCall, Hex } from "./index.ts";

// A call names a function, so `functionName` resolves among an ABI's functions
// only. ox resolves a name among every ABI item that has it, and would let an
// event or error that shares the name take part as an overload.
type FunctionsOf<TAbi extends Abi> = readonly Extract<
	TAbi[number],
	{ type: "function" }
>[];

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
	: FunctionCall<FunctionsOf<TAbi>[number]>);

type CallFunctionName<TCall extends GhostcallAbiCall> = TCall["functionName"] &
	AbiItem.Name<FunctionsOf<TCall["abi"]>>;

type CallArguments<TCall extends GhostcallAbiCall> = TCall extends {
	args: infer TArgs extends readonly unknown[];
}
	? TArgs
	: readonly [];

// Infer ox's argument constraint through its public options, then let ox choose
// the overload. This keeps our result types aligned with runtime resolution.
type ResolvedFunction<TCall extends GhostcallAbiCall> =
	AbiItem.fromAbi.Options<
		FunctionsOf<TCall["abi"]>,
		CallFunctionName<TCall>
	> extends AbiItem.fromAbi.Options<
		FunctionsOf<TCall["abi"]>,
		CallFunctionName<TCall>,
		infer TArgs
	>
		? AbiItem.fromAbi.ReturnType<
				FunctionsOf<TCall["abi"]>,
				CallFunctionName<TCall>,
				Extract<CallArguments<TCall>, TArgs>
			>
		: never;

/** The decoded result of an ABI call, including argument-selected overloads. */
type GhostcallAbiResult<TCall extends GhostcallAbiCall> =
	AbiFunction.decodeResult.ReturnType<
		Extract<ResolvedFunction<TCall>, AbiFunction.AbiFunction>
	>;

// One ABI object's functions and the names resolved from them within one batch.
// `null` marks a name that must be resolved per call from its arguments.
type SharedFunctions = {
	functions: FunctionsOf<Abi>;
	byName: Map<string, AbiFunction.AbiFunction | null>;
};
type SharedFunctionsByAbi = Map<Abi, SharedFunctions>;

/**
 * Turn ABI calls into raw decoded calls that encode and decode with the same
 * resolved function. Raw decoded calls pass through unchanged.
 */
function prepareDecodedCalls(
	calls: readonly (GhostcallAbiCall | GhostcallDecodedCall)[]
): GhostcallDecodedCall[] {
	const sharedFunctions: SharedFunctionsByAbi = new Map();
	return calls.map((call): GhostcallDecodedCall => {
		if (call.abi === undefined) {
			return call;
		}
		const args = call.args ?? [];
		const abiFunction = resolveAbiFunction(call, args, sharedFunctions);
		// ox encodes only the selector when args are missing, so reject that
		// before RPC; literal ABIs catch it in types, runtime-loaded ABIs cannot.
		if (args.length !== abiFunction.inputs.length) {
			throw new TypeError(
				`${call.functionName} expects ${abiFunction.inputs.length} arguments, received ${args.length}`
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
// once when it can. ox ignores args when exactly one of the functions has the
// name. Other names resolve per call, by argument types.
function resolveAbiFunction(
	call: GhostcallAbiCall,
	args: readonly unknown[],
	sharedFunctions: SharedFunctionsByAbi
): AbiFunction.AbiFunction {
	let shared = sharedFunctions.get(call.abi);
	if (shared === undefined) {
		shared = {
			functions: call.abi.filter((item) => item.type === "function"),
			byName: new Map(),
		};
		sharedFunctions.set(call.abi, shared);
	}
	const { functions, byName } = shared;
	let abiFunction = byName.get(call.functionName);
	if (abiFunction === undefined) {
		const matches = functions.filter((item) => item.name === call.functionName);
		abiFunction =
			matches.length === 1
				? AbiFunction.fromAbi(functions, call.functionName)
				: null;
		byName.set(call.functionName, abiFunction);
	}
	if (abiFunction) {
		return abiFunction;
	}
	const resolved = AbiFunction.fromAbi(functions, call.functionName, { args });
	// When no overload accepts the args, ox returns its first candidate with the
	// others attached as `overloads`. Encoding it would call a function the args
	// did not select; literal ABIs catch that in types, runtime-loaded ABIs cannot.
	if (args.length > 0 && "overloads" in resolved) {
		throw new TypeError(
			`${call.functionName} has no overload that accepts the supplied arguments`
		);
	}
	return resolved;
}

export type { GhostcallAbiCall, GhostcallAbiResult };
export { prepareDecodedCalls };
