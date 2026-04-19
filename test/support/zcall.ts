import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Abi, AbiFunction, Bytes, Hex } from "ox";

import {
	type RawRpcResponse,
	type RpcErrorObject,
	type Transport,
	sendTransaction,
} from "./anvil.ts";

const projectRoot = process.cwd();

export type Artifact = {
	abi?: Abi.Abi;
	bytecode?: {
		object?: string;
	};
};

export type CallSpec = {
	target: Hex.Hex;
	calldata: Hex.Hex;
};

export type ZCallEntry = {
	success: boolean;
	returndata: Hex.Hex;
};

type AnyFunction = ReturnType<typeof AbiFunction.from>;

export async function loadArtifact(relativePath: string): Promise<Artifact> {
	const filePath = join(projectRoot, relativePath);
	return JSON.parse(await readFile(filePath, "utf8")) as Artifact;
}

export function readAbi(artifact: Artifact, artifactPath: string): Abi.Abi {
	assert.ok(artifact.abi, `Missing ABI in ${artifactPath}`);
	return artifact.abi;
}

export function readBytecode(artifact: Artifact, artifactPath: string): Hex.Hex {
	const bytecode = artifact.bytecode?.object;
	assert.ok(
		bytecode && bytecode !== "0x",
		`Missing bytecode in ${artifactPath}`,
	);
	return normalizeHex(bytecode);
}

export function buildZCallData(
	zcallInitcode: Hex.Hex,
	calls: readonly CallSpec[],
): Hex.Hex {
	const parts = [];

	for (const call of calls) {
		parts.push(Bytes.from(call.target));
		parts.push(Bytes.fromNumber(Hex.size(call.calldata), { size: 2 }));
		parts.push(Bytes.from(call.calldata));
	}

	return Hex.concat(zcallInitcode, Bytes.toHex(Bytes.concat(...parts)));
}

export function decodeZCallResponse(data: Hex.Hex): ZCallEntry[] {
	const bytes = Bytes.fromHex(data);
	const entries: ZCallEntry[] = [];
	let cursor = 0;

	while (cursor < Bytes.size(bytes)) {
		assert.ok(
			cursor + 2 <= Bytes.size(bytes),
			"Truncated ZCall response header",
		);

		const header = Bytes.toNumber(Bytes.slice(bytes, cursor, cursor + 2), {
			size: 2,
		});
		const success = (header & 0x8000) !== 0;
		const returndataLength = header & 0x7fff;
		const returndataStart = cursor + 2;
		const returndataEnd = returndataStart + returndataLength;

		assert.ok(
			returndataEnd <= Bytes.size(bytes),
			"Truncated ZCall response body",
		);

		entries.push({
			success,
			returndata: Bytes.toHex(
				Bytes.slice(bytes, returndataStart, returndataEnd),
			),
		});

		cursor = returndataEnd;
	}

	return entries;
}

export async function sendFunctionTransaction(
	transport: Transport,
	to: Hex.Hex,
	abiFunction: AnyFunction,
	args: readonly unknown[],
): Promise<void> {
	await sendTransaction(transport, {
		to,
		data: encodeFunctionData(abiFunction, args),
	});
}

export function getRpcError(
	response: RawRpcResponse<Hex.Hex>,
): RpcErrorObject {
	if ("error" in response) {
		return response.error;
	}

	assert.fail(`Expected RPC error, received result ${response.result}`);
}

export function getRevertData(error: RpcErrorObject): Hex.Hex {
	const { data } = error;
	if (typeof data !== "string") {
		throw new Error(`Expected string revert data, received ${typeof data}`);
	}

	return normalizeHex(data);
}

export function encodeFunctionData(
	abiFunction: AnyFunction,
	args: readonly unknown[],
): Hex.Hex {
	return AbiFunction.encodeData(abiFunction as never, args as never);
}

export function encodeFunctionResult(
	abiFunction: AnyFunction,
	output: unknown,
): Hex.Hex {
	return AbiFunction.encodeResult(abiFunction as never, output as never);
}

export function decodeFunctionResult(
	abiFunction: AnyFunction,
	result: Hex.Hex,
): unknown {
	return AbiFunction.decodeResult(abiFunction as never, result);
}

function normalizeHex(value: string): Hex.Hex {
	return (value.startsWith("0x") ? value : `0x${value}`) as Hex.Hex;
}
