import { Session } from "node:inspector/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { from as parseAbi } from "ox/Abi";
import type {
	GhostcallAbiCall,
	GhostcallDecodedCall,
	GhostcallProvider,
	Hex,
} from "../src/sdk/index.ts";

// The optional module path selects the SDK for this measurement.
// The SDK must use the same wire format as these fixtures.
const sdk: typeof import("../src/sdk/index.ts") = await import(
	process.argv[2]
		? pathToFileURL(resolve(process.argv[2])).href
		: new URL("../src/sdk/index.ts", import.meta.url).href
);
const to = "0x1111111111111111111111111111111111111111";
const balanceOf = "function balanceOf(address owner) view returns (uint256)";
const abi = parseAbi([balanceOf]);
const overloadedAbi = parseAbi([
	balanceOf,
	"function balanceOf(address owner, uint256 id) view returns (uint256)",
]);
let checksum = 0;

async function measure(
	name: string,
	iterations: number,
	run: (iterations: number) => void | Promise<void>,
): Promise<void> {
	await run(iterations);
	const samples: number[] = [];
	for (let sample = 0; sample < 7; sample += 1) {
		globalThis.gc?.();
		const start = performance.now();
		await run(iterations);
		samples.push(((performance.now() - start) * 1_000) / iterations);
	}
	samples.sort((a, b) => a - b);

	// Measure allocations in an isolated run to keep profiler costs out of the time measurement.
	// Include objects that the garbage collector removed.
	// The remaining heap does not show all temporary allocations.
	const session = new Session();
	session.connect();
	let allocatedBytes = 0;
	try {
		await session.post("HeapProfiler.startSampling", {
			samplingInterval: 4_096,
			includeObjectsCollectedByMajorGC: true,
			includeObjectsCollectedByMinorGC: true,
		});
		await run(iterations);
		const { profile } = await session.post("HeapProfiler.stopSampling");
		const nodes = [profile.head];
		for (const node of nodes) {
			allocatedBytes += node.selfSize;
			nodes.push(...node.children);
		}
	} finally {
		session.disconnect();
	}
	console.log(
		`${name.padEnd(44)} ${samples[3]?.toFixed(2).padStart(10)} µs/batch ${(allocatedBytes / iterations / 1_024).toFixed(2).padStart(10)} KiB allocated/batch`,
	);
}

console.log(`SDK benchmark (${process.version}, median of 7 runs)`);
console.log(
	"Allocation values are estimates from sampling. They do not show the maximum heap size or the heap that remains.",
);
for (const count of [1, 100, 700]) {
	const calls: GhostcallDecodedCall[] = Array.from({ length: count }, () => ({
		to,
		data: `0x70a08231${"00".repeat(32)}`,
		decodeResult: (data) => data.length,
	}));
	const response: Hex = `0x${`0041${"ab".repeat(32)}`.repeat(count)}`;
	const provider: GhostcallProvider = {
		request: async ({ params }) => {
			const [{ data }] = params as [{ data: Hex }, string];
			checksum ^= data.charCodeAt(data.length - 1);
			return response;
		},
	};
	const iterations = Math.ceil(100_000 / count);
	await measure(`encodeCalls (${count})`, iterations, (iterations) => {
		for (let index = 0; index < iterations; index += 1) {
			const data = sdk.encodeCalls(calls);
			// Read the last byte to include the cost of string concatenation.
			checksum ^= data.charCodeAt(data.length - 1);
		}
	});
	await measure(`decodeResults (${count})`, iterations, (iterations) => {
		for (let index = 0; index < iterations; index += 1)
			checksum ^= sdk.decodeResults(response).length;
	});
	const batchCases: [string, () => Promise<unknown[]>][] = [
		["aggregateCalls", () => sdk.aggregateCalls(provider, calls)],
		["aggregateDecodedCalls", () => sdk.aggregateDecodedCalls(provider, calls)],
	];
	const abiCases: [string, () => GhostcallAbiCall][] = [
		["ABI", () => ({ to, abi, functionName: "balanceOf", args: [to] })],
		// Use one function lookup for each call with an overloaded name.
		[
			"overloaded ABI",
			() => ({ to, abi: overloadedAbi, functionName: "balanceOf", args: [to] }),
		],
		// The batch uses the ABI object as the cache key.
		[
			"per-call ABI",
			() => ({
				to,
				abi: parseAbi([balanceOf]),
				functionName: "balanceOf",
				args: [to],
			}),
		],
	];
	for (const [label, createCall] of abiCases) {
		const abiCalls = Array.from({ length: count }, createCall);
		batchCases.push([
			`aggregateDecodedCalls ${label}`,
			() => sdk.aggregateDecodedCalls(provider, abiCalls),
		]);
	}
	for (const [name, runBatch] of batchCases) {
		await measure(`${name} (${count})`, iterations, async (iterations) => {
			for (let index = 0; index < iterations; index += 1)
				checksum ^= (await runBatch()).length;
		});
	}
}
console.log(`Checksum: ${checksum}`);
