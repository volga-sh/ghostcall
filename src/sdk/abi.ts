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

/** Bind encoding and decoding to the same resolved ABI function. */
function prepareAbiCall(call: GhostcallAbiCall): GhostcallDecodedCall {
	const args = call.args ?? [];
	const abiFunction = AbiFunction.fromAbi(call.abi, call.functionName, {
		args,
	});

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

export type { GhostcallAbiCall, GhostcallAbiResult };
export { prepareAbiCall };
