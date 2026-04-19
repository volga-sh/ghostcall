import assert from "node:assert/strict";
import test from "node:test";

import { Abi, AbiError, AbiFunction, Hex } from "ox";

import {
	deployContract,
	ethCallCreate,
	ethCallCreateRaw,
	startAnvil,
	stopAnvil,
} from "./support/anvil.ts";
import {
	buildZCallData,
	decodeFunctionResult,
	decodeZCallResponse,
	encodeFunctionData,
	encodeFunctionResult,
	getRevertData,
	getRpcError,
	loadArtifact,
	readAbi,
	readBytecode,
	sendFunctionTransaction,
} from "./support/zcall.ts";

const mockArtifactPath = "out/MockContract.sol/MockContract.json";
const zcallArtifactPath = "out/ZCall.yul/ZCall.json";

const emptyAbi = Abi.from([]);

test("ZCall integration", async (t) => {
	const anvil = await startAnvil();
	t.after(async () => {
		await stopAnvil(anvil);
	});

	const zcallArtifact = await loadArtifact(zcallArtifactPath);
	const mockArtifact = await loadArtifact(mockArtifactPath);

	const zcallInitcode = readBytecode(zcallArtifact, zcallArtifactPath);
	const mockInitcode = readBytecode(mockArtifact, mockArtifactPath);
	const mockAbi = readAbi(mockArtifact, mockArtifactPath);
	const mockAddress = await deployContract(anvil.transport, mockInitcode);

	const getValue = AbiFunction.from("function getValue() returns (uint256)");
	const getGreeting = AbiFunction.from(
		"function getGreeting() returns (string)",
	);
	const echoUint = AbiFunction.from(
		"function echoUint(uint256) returns (uint256)",
	);
	const fail = AbiFunction.from("function fail()");

	const givenCalldataReturn = AbiFunction.fromAbi(
		mockAbi,
		"givenCalldataReturn",
	);
	const givenMethodReturn = AbiFunction.fromAbi(mockAbi, "givenMethodReturn");
	const givenCalldataRevertWithMessage = AbiFunction.fromAbi(
		mockAbi,
		"givenCalldataRevertWithMessage",
	);
	const reset = AbiFunction.fromAbi(mockAbi, "reset");

	await t.test(
		"aggregates configured returndata and revert data from the mock",
		async () => {
			await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

			const getValueCall = encodeFunctionData(getValue, []);
			const getGreetingCall = encodeFunctionData(getGreeting, []);
			const failCall = encodeFunctionData(fail, []);

			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[getValueCall, encodeFunctionResult(getValue, 0x11223344n)],
			);
			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[
					getGreetingCall,
					encodeFunctionResult(getGreeting, "hello from mock-contract"),
				],
			);
			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataRevertWithMessage,
				[failCall, "mocked revert"],
			);

			const result = await ethCallCreate(
				anvil.transport,
				buildZCallData(zcallInitcode, [
					{ target: mockAddress, calldata: getValueCall },
					{ target: mockAddress, calldata: getGreetingCall },
					{ target: mockAddress, calldata: failCall },
				]),
			);

			const entries = decodeZCallResponse(result);

			assert.equal(entries.length, 3);
			assert.equal(entries[0]?.success, true);
			assert.equal(
				decodeFunctionResult(getValue, entries[0]!.returndata),
				0x11223344n,
			);

			assert.equal(entries[1]?.success, true);
			assert.equal(
				decodeFunctionResult(getGreeting, entries[1]!.returndata),
				"hello from mock-contract",
			);

			assert.equal(entries[2]?.success, false);
			const revertError = AbiError.fromAbi(emptyAbi, entries[2]!.returndata);
			assert.equal(revertError.name, "Error");
			assert.equal(
				AbiError.decode(revertError, entries[2]!.returndata),
				"mocked revert",
			);
		},
	);

	await t.test(
		"prefers exact calldata mocks over method-level mocks",
		async () => {
			await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

			const echoSevenCall = encodeFunctionData(echoUint, [7n]);
			const echoEightCall = encodeFunctionData(echoUint, [8n]);
			const echoNineCall = encodeFunctionData(echoUint, [9n]);

			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenMethodReturn,
				[echoSevenCall, encodeFunctionResult(echoUint, 700n)],
			);
			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenCalldataReturn,
				[echoEightCall, encodeFunctionResult(echoUint, 800n)],
			);

			const result = await ethCallCreate(
				anvil.transport,
				buildZCallData(zcallInitcode, [
					{ target: mockAddress, calldata: echoSevenCall },
					{ target: mockAddress, calldata: echoEightCall },
					{ target: mockAddress, calldata: echoNineCall },
				]),
			);

			const entries = decodeZCallResponse(result);

			assert.equal(entries.length, 3);
			assert.equal(
				decodeFunctionResult(echoUint, entries[0]!.returndata),
				700n,
			);
			assert.equal(
				decodeFunctionResult(echoUint, entries[1]!.returndata),
				800n,
			);
			assert.equal(
				decodeFunctionResult(echoUint, entries[2]!.returndata),
				700n,
			);
		},
	);

	await t.test("returns failure entries and continues the batch", async () => {
		await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

		const failCall = encodeFunctionData(fail, []);
		const getValueCall = encodeFunctionData(getValue, []);

		await sendFunctionTransaction(
			anvil.transport,
			mockAddress,
			givenCalldataRevertWithMessage,
			[failCall, "fatal mock revert"],
		);
		await sendFunctionTransaction(
			anvil.transport,
			mockAddress,
			givenCalldataReturn,
			[getValueCall, encodeFunctionResult(getValue, 0x55n)],
		);

		const result = await ethCallCreate(
			anvil.transport,
			buildZCallData(zcallInitcode, [
				{ target: mockAddress, calldata: failCall },
				{ target: mockAddress, calldata: getValueCall },
			]),
		);

		const entries = decodeZCallResponse(result);

		assert.equal(entries.length, 2);
		assert.equal(entries[0]?.success, false);

		const revertError = AbiError.fromAbi(emptyAbi, entries[0]!.returndata);
		assert.equal(revertError.name, "Error");
		assert.equal(
			AbiError.decode(revertError, entries[0]!.returndata),
			"fatal mock revert",
		);

		assert.equal(entries[1]?.success, true);
		assert.equal(decodeFunctionResult(getValue, entries[1]!.returndata), 0x55n);
	});

	await t.test("returns empty bytes for an empty batch", async () => {
		const result = await ethCallCreate(anvil.transport, zcallInitcode);
		assert.equal(result, "0x");
	});

	await t.test("reverts on malformed trailing bytes", async () => {
		const response = await ethCallCreateRaw(
			anvil.transport,
			Hex.concat(zcallInitcode, "0x00"),
		);
		const error = getRpcError(response);
		const revertData = getRevertData(error);

		assert.equal(revertData, "0x");
	});
});
