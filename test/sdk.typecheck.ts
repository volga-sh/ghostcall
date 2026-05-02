import type { GhostcallDecodedCall } from "../src/sdk/index.ts";

const missingDecodeResultCalls: readonly [GhostcallDecodedCall] = [
	// @ts-expect-error aggregateDecodedCalls requires decodeResult on every call.
	{
		to: "0x1111111111111111111111111111111111111111",
		data: "0x",
	},
];

const allowFailureDecodedCalls: readonly [GhostcallDecodedCall] = [
	{
		to: "0x1111111111111111111111111111111111111111",
		data: "0x",
		// @ts-expect-error aggregateDecodedCalls does not accept allowFailure.
		allowFailure: true,
		decodeResult: (returnData: `0x${string}`) => returnData,
	},
];

void missingDecodeResultCalls;
void allowFailureDecodedCalls;
