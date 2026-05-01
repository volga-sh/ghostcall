import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type Abi, AbiFunction, type Hex } from "ox";

import {
	type RawRpcResponse,
	type RpcErrorObject,
	sendTransaction,
	type Transport,
} from "./anvil.ts";

const projectRoot = process.cwd();

type Artifact = {
	abi?: Abi.Abi;
	bytecode?: {
		object?: string;
	};
};

type AnyFunction = ReturnType<typeof AbiFunction.from>;

async function loadArtifact(relativePath: string): Promise<Artifact> {
	const filePath = join(projectRoot, relativePath);
	return JSON.parse(await readFile(filePath, "utf8")) as Artifact;
}

function readAbi(artifact: Artifact, artifactPath: string): Abi.Abi {
	assert.ok(artifact.abi, `Missing ABI in ${artifactPath}`);
	return artifact.abi;
}

function readBytecode(artifact: Artifact, artifactPath: string): Hex.Hex {
	const bytecode = artifact.bytecode?.object;
	assert.ok(
		bytecode && bytecode !== "0x",
		`Missing bytecode in ${artifactPath}`,
	);
	return normalizeHex(bytecode);
}

async function sendFunctionTransaction(
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

function getRpcError(response: RawRpcResponse<Hex.Hex>): RpcErrorObject {
	if ("error" in response) {
		return response.error;
	}

	assert.fail(`Expected RPC error, received result ${response.result}`);
}

function getRevertData(error: RpcErrorObject): Hex.Hex {
	const { data } = error;
	if (typeof data !== "string") {
		throw new Error(`Expected string revert data, received ${typeof data}`);
	}

	return normalizeHex(data);
}

function encodeFunctionData(
	abiFunction: AnyFunction,
	args: readonly unknown[],
): Hex.Hex {
	return AbiFunction.encodeData(abiFunction as never, args as never);
}

function encodeFunctionResult(
	abiFunction: AnyFunction,
	output: unknown,
): Hex.Hex {
	return AbiFunction.encodeResult(abiFunction as never, output as never);
}

function decodeFunctionResult(
	abiFunction: AnyFunction,
	result: Hex.Hex,
): unknown {
	return AbiFunction.decodeResult(abiFunction as never, result);
}

function normalizeHex(value: string): Hex.Hex {
	return (value.startsWith("0x") ? value : `0x${value}`) as Hex.Hex;
}

export type { Artifact };
export {
	decodeFunctionResult,
	encodeFunctionData,
	encodeFunctionResult,
	getRevertData,
	getRpcError,
	loadArtifact,
	readAbi,
	readBytecode,
	sendFunctionTransaction,
};
