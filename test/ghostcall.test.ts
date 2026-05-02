import assert from "node:assert/strict";
import test from "node:test";
import { Abi, AbiError, AbiFunction, Hex } from "ox";
import {
	aggregateCalls,
	aggregateDecodedCalls,
	encodeCalls,
} from "../src/sdk/index.ts";

import {
	deployContract,
	ethCallCreateRaw,
	startAnvil,
	stopAnvil,
} from "./support/anvil.ts";
import {
	decodeFunctionResult,
	encodeFunctionData,
	encodeFunctionResult,
	getRevertData,
	getRpcError,
	loadArtifact,
	readAbi,
	readBytecode,
	sendFunctionTransaction,
} from "./support/ghostcall.ts";

const mockArtifactPath = "out/MockContract.sol/MockContract.json";
const oversizedReturnRuntimeInitcode =
	"0x6006600c60003960066000f36180006000f3" as Hex.Hex;

const emptyAbi = Abi.from([]);
const maxCreateReturnSize = 0x6000;
const encodedResultHeaderSize = 0x02;
const maxSingleReturnDataSize = maxCreateReturnSize - encodedResultHeaderSize;

test("Ghostcall integration", async (t) => {
	const anvil = await startAnvil();
	t.after(async () => {
		await stopAnvil(anvil);
	});

	const mockArtifact = await loadArtifact(mockArtifactPath);
	const mockInitcode = readBytecode(mockArtifact, mockArtifactPath);
	const mockAbi = readAbi(mockArtifact, mockArtifactPath);
	const mockAddress = await deployContract(anvil.transport, mockInitcode);

	const getValue = AbiFunction.from("function getValue() returns (uint256)");
	const getGreeting = AbiFunction.from(
		"function getGreeting() returns (string)",
	);
	const fail = AbiFunction.from("function fail()");
	const balanceOf = AbiFunction.from(
		"function balanceOf(address) view returns (uint256)",
	);
	const invocationCount = AbiFunction.from(
		"function invocationCount() returns (uint256)",
	);

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

			const decodedResults = await aggregateDecodedCalls(anvil.transport, [
				{
					to: mockAddress,
					data: getValueCall,
					decodeResult: (returnData) =>
						decodeFunctionResult(getValue, returnData),
				},
				{
					to: mockAddress,
					data: getGreetingCall,
					decodeResult: (returnData) =>
						decodeFunctionResult(getGreeting, returnData),
				},
			]);
			const failureEntries = await aggregateCalls(anvil.transport, [
				{ to: mockAddress, data: failCall, allowFailure: true },
			]);
			const [valueResult, greetingResult] = decodedResults;
			const [failureEntry] = failureEntries;

			assert.equal(valueResult, 0x11223344n);
			assert.equal(greetingResult, "hello from mock-contract");

			assert.ok(failureEntry);
			assert.equal(failureEntry.success, false);
			const revertError = AbiError.fromAbi(emptyAbi, failureEntry.returnData);
			assert.equal(revertError.name, "Error");
			assert.equal(
				AbiError.decode(revertError, failureEntry.returnData),
				"mocked revert",
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

		await assert.rejects(
			aggregateCalls(anvil.transport, [
				{ to: mockAddress, data: failCall },
				{ to: mockAddress, data: getValueCall },
			]),
			/Ghostcall subcall 0 failed/,
		);

		const entries = await aggregateCalls(anvil.transport, [
			{ to: mockAddress, data: failCall, allowFailure: true },
			{ to: mockAddress, data: getValueCall },
		]);
		const [failureEntry, successEntry] = entries;

		assert.ok(failureEntry);
		assert.equal(failureEntry.success, false);

		const revertError = AbiError.fromAbi(emptyAbi, failureEntry.returnData);
		assert.equal(revertError.name, "Error");
		assert.equal(
			AbiError.decode(revertError, failureEntry.returnData),
			"fatal mock revert",
		);

		assert.ok(successEntry);
		assert.equal(successEntry.success, true);
		assert.equal(
			decodeFunctionResult(getValue, successEntry.returnData),
			0x55n,
		);
	});

	await t.test("returns an empty result list for an empty batch", async () => {
		const entries = await aggregateCalls(anvil.transport, []);
		assert.deepEqual(entries, []);
	});

	await t.test(
		"uses CALL semantics so same-batch state changes are visible to later calls",
		async () => {
			await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

			const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			const balanceCall = encodeFunctionData(balanceOf, [owner]);
			const invocationCountCall = encodeFunctionData(invocationCount, []);

			await sendFunctionTransaction(
				anvil.transport,
				mockAddress,
				givenMethodReturn,
				[balanceCall, encodeFunctionResult(balanceOf, 123n)],
			);

			const [, countEntry] = await aggregateCalls(anvil.transport, [
				{ to: mockAddress, data: balanceCall },
				{ to: mockAddress, data: invocationCountCall },
			]);

			assert.ok(countEntry);
			assert.equal(countEntry.success, true);
			assert.equal(
				decodeFunctionResult(invocationCount, countEntry.returnData),
				1n,
			);
		},
	);

	await t.test("returns data up to the CREATE return-size limit", async () => {
		await sendFunctionTransaction(anvil.transport, mockAddress, reset, []);

		const largeCall = "0x12345678";
		const maxSizedResponse =
			`0x${"11".repeat(maxSingleReturnDataSize)}` as Hex.Hex;

		await sendFunctionTransaction(
			anvil.transport,
			mockAddress,
			givenCalldataReturn,
			[largeCall, maxSizedResponse],
		);

		const [entry] = await aggregateCalls(anvil.transport, [
			{ to: mockAddress, data: largeCall },
		]);

		assert.ok(entry);
		assert.equal(entry.success, true);
		assert.equal(entry.returnData, maxSizedResponse);
	});

	await t.test("reverts on malformed trailing bytes", async () => {
		const response = await ethCallCreateRaw(
			anvil.transport,
			Hex.concat(encodeCalls([]), "0x00"),
		);
		const error = getRpcError(response);
		const revertData = getRevertData(error);

		assert.equal(revertData, "0x");
	});
});

test("Ghostcall can return aggregate responses above the old in-contract cap", async (t) => {
	const anvil = await startAnvil({ args: ["--code-size-limit", "32768"] });
	t.after(async () => {
		await stopAnvil(anvil);
	});

	const mockArtifact = await loadArtifact(mockArtifactPath);
	const mockInitcode = readBytecode(mockArtifact, mockArtifactPath);
	const mockAbi = readAbi(mockArtifact, mockArtifactPath);
	const mockAddress = await deployContract(anvil.transport, mockInitcode);

	const balanceOf = AbiFunction.from(
		"function balanceOf(address) view returns (uint256)",
	);
	const givenMethodReturn = AbiFunction.fromAbi(mockAbi, "givenMethodReturn");
	const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	const balanceCall = encodeFunctionData(balanceOf, [owner]);
	const balanceResult = encodeFunctionResult(balanceOf, 123n);

	await sendFunctionTransaction(
		anvil.transport,
		mockAddress,
		givenMethodReturn,
		[balanceCall, balanceResult],
	);

	const callCount = Math.floor(0x6000 / (2 + 32)) + 1;
	const entries = await aggregateCalls(
		anvil.transport,
		Array.from({ length: callCount }, () => ({
			to: mockAddress,
			data: balanceCall,
		})),
	);

	assert.ok(
		callCount * (encodedResultHeaderSize + byteLength(balanceResult)) > 0x6000,
	);
	assert.equal(entries.length, callCount);

	for (const entry of entries) {
		assert.equal(entry.success, true);
		assert.equal(entry.returnData, balanceResult);
	}
});

test("Ghostcall returns one entry at the uint15 returndata header limit", async (t) => {
	const anvil = await startAnvil({ args: ["--code-size-limit", "65536"] });
	t.after(async () => {
		await stopAnvil(anvil);
	});

	const mockArtifact = await loadArtifact(mockArtifactPath);
	const mockInitcode = readBytecode(mockArtifact, mockArtifactPath);
	const mockAbi = readAbi(mockArtifact, mockArtifactPath);
	const mockAddress = await deployContract(anvil.transport, mockInitcode);

	const givenCalldataReturn = AbiFunction.fromAbi(
		mockAbi,
		"givenCalldataReturn",
	);
	const largeCall = "0x12345678";
	const maxSizedResponse = `0x${"11".repeat(0x7fff)}` as Hex.Hex;

	await sendFunctionTransaction(
		anvil.transport,
		mockAddress,
		givenCalldataReturn,
		[largeCall, maxSizedResponse],
	);

	const [entry] = await aggregateCalls(anvil.transport, [
		{ to: mockAddress, data: largeCall },
	]);

	assert.ok(entry);
	assert.equal(entry.success, true);
	assert.equal(entry.returnData, maxSizedResponse);
});

test("Ghostcall reverts when one entry exceeds the uint15 returndata header", async (t) => {
	const anvil = await startAnvil({ args: ["--code-size-limit", "65536"] });
	t.after(async () => {
		await stopAnvil(anvil);
	});

	const oversizedReturnAddress = await deployContract(
		anvil.transport,
		oversizedReturnRuntimeInitcode,
	);
	const response = await ethCallCreateRaw(
		anvil.transport,
		encodeCalls([{ to: oversizedReturnAddress, data: "0x" }]),
	);
	const error = getRpcError(response);

	assert.equal(getRevertData(error), "0x");
});

function byteLength(value: `0x${string}`): number {
	return (value.length - 2) / 2;
}
