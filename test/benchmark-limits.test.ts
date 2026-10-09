import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { size as hexSize } from "ox/Hex";
import {
	type BenchmarkConfig,
	balanceInputBytesPerCall,
	buildBalanceCalls,
	createRawInitcodeSizeProbe,
	createRawRuntimeReturnProbe,
	findLimit,
	parseBenchmarkArgs,
	runBenchmark,
} from "../scripts/benchmark-limits.ts";
import { ghostcallInitcode } from "../src/sdk/generated/initcode.ts";
import type { Hex } from "../src/sdk/index.ts";

const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";
const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const env = { GHOSTCALL_BENCH_RPC_URL: "https://env.invalid/rpc" };
const initcodeBytes = hexSize(ghostcallInitcode);
const config = {
	rpcUrl: env.GHOSTCALL_BENCH_RPC_URL,
	mode: "balances",
	tokens: [tokenA],
	owners: [ownerA],
	blockTag: "latest",
	from: ownerA,
	timeoutMs: 30_000,
	maxCalls: 10,
	maxInitcodeBytes: initcodeBytes + 5 * balanceInputBytesPerCall,
	maxRuntimeBytes: 1,
	json: false,
} satisfies BenchmarkConfig;

test("parses comma-separated and repeated addresses, numbers, and env fallbacks", () => {
	assert.deepEqual(
		parseBenchmarkArgs(
			[
				"--mode=balances",
				`--token=${tokenA},${tokenB}`,
				"--owner",
				ownerA,
				"--owner",
				ownerB,
				"--block=123",
				`--from=${ownerA}`,
				"--gas=1000000",
				"--max-calls=10",
				`--max-initcode-bytes=${config.maxInitcodeBytes}`,
				"--max-runtime-bytes=0x1",
			],
			env,
		),
		{
			...config,
			tokens: [tokenA, tokenB],
			owners: [ownerA, ownerB],
			blockTag: "0x7b",
			gas: "0xf4240",
		},
	);
	const raw = parseBenchmarkArgs(["--mode=raw"], {
		...env,
		GHOSTCALL_BENCH_TOKENS: "not an address",
	});
	assert.deepEqual([raw.tokens, raw.owners], [[], []]);
});

test("rejects missing balance inputs, invalid addresses, and invalid numbers", () => {
	for (const [args, error] of [
		[["--mode=balances"], /--token/],
		[["--mode=balances", `--token=${tokenA}`], /--owner/],
		[["--token=0x1234", `--owner=${ownerA}`], /--token\[0\]/],
		[["--mode=raw", "--from=0x1234"], /--from/],
		[["--mode=raw", "--gas=banana"], /--gas must be/],
		[["--mode=raw", "--max-calls=Infinity"], /--max-calls must be/],
	] as const) {
		assert.throws(() => parseBenchmarkArgs(args, env), error, args.join(" "));
	}
});

test("builds exact probe bytes and rotates tokens before owners", () => {
	assert.equal(hexSize(createRawInitcodeSizeProbe(10)), 10);
	assert.equal(createRawRuntimeReturnProbe(1), "0x60016000f3");
	assert.equal(createRawRuntimeReturnProbe(256), "0x6101006000f3");
	const balanceOf = (owner: Hex) =>
		`0x70a08231${"0".repeat(24)}${owner.slice(2)}`;
	assert.deepEqual(buildBalanceCalls(3, [tokenA, tokenB], [ownerA, ownerB]), [
		{ to: tokenA, data: balanceOf(ownerA) },
		{ to: tokenB, data: balanceOf(ownerA) },
		{ to: tokenA, data: balanceOf(ownerB) },
	]);
});

test("finds the threshold without duplicate probes, or reports a lower bound", async () => {
	const candidates: number[] = [];
	const result = await findLimit(1, 20, async (candidate) => {
		candidates.push(candidate);
		return candidate <= 13 ? null : "too large";
	});
	assert.equal(result.maxPass, 13);
	assert.equal(result.firstFail, 14);
	assert.equal(result.exhaustedConfiguredMax, false);
	assert.equal(new Set(candidates).size, candidates.length);

	const bounded = await findLimit(1, 10, async () => null);
	assert.equal(bounded.maxPass, 10);
	assert.equal(bounded.firstFail, null);
	assert.equal(bounded.exhaustedConfiguredMax, true);
	assert.equal(bounded.failure, null);
});

test("caps balance searches by configured initcode bytes", async (t) => {
	const counts: number[] = [];
	mockBalanceRpc(t, (count) => {
		counts.push(count);
		return balanceResultPayload(count);
	});
	const maxInitcodeBytes = initcodeBytes + 3 * balanceInputBytesPerCall;
	const report = await runBenchmark({ ...config, maxInitcodeBytes });
	assert.equal(report.balances?.maxPass, 3);
	assert.equal(report.balances?.exhaustedConfiguredMax, true);
	assert.equal(report.balances?.fullCreateDataBytes, maxInitcodeBytes);
	assert.equal(report.ghostcallInitcodeBytes, initcodeBytes);
	assert.equal(report.balances?.returnedBytes, 3 * 34);
	assert.deepEqual(counts, [1, 2, 3]);
});

test("reports failed balance subcalls as probe failures", async (t) => {
	const counts: number[] = [];
	mockBalanceRpc(t, (count) => {
		counts.push(count);
		return balanceResultPayload(count, count <= 2);
	});
	const report = await runBenchmark({ ...config, maxCalls: 5 });
	assert.equal(report.balances?.maxPass, 2);
	assert.equal(report.balances?.firstFail, 3);
	assert.equal(
		report.balances?.failure,
		"balanceOf call 0 returned a failed result entry",
	);
	assert.deepEqual(counts, [1, 2, 4, 3]);
});

function mockBalanceRpc(
	t: TestContext,
	resultFor: (count: number) => Hex,
): void {
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		const { id, method, params } = JSON.parse(String(init?.body)) as {
			id: number;
			method: string;
			params: [{ data: Hex }];
		};
		let result: Hex;
		if (method === "eth_chainId") result = "0x1";
		else if (method === "eth_blockNumber") result = "0x2";
		else {
			assert.equal(method, "eth_call");
			const count =
				(hexSize(params[0].data) - initcodeBytes) / balanceInputBytesPerCall;
			assert.ok(Number.isInteger(count));
			result = resultFor(count);
		}
		return Response.json({ jsonrpc: "2.0", id, result });
	};
	t.mock.method(globalThis, "fetch", fetch);
}

function balanceResultPayload(count: number, success = true): Hex {
	return `0x${`${success ? "0041" : "0040"}${"00".repeat(32)}`.repeat(count)}`;
}
