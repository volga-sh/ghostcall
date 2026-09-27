import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { size as hexSize } from "ox/Hex";
import {
	type BenchmarkConfig,
	balanceInputBytesPerCall,
	createRawInitcodeSizeProbe,
	createRawRuntimeReturnProbe,
	encodeBalanceOfCalldata,
	findLimit,
	parseBenchmarkArgs,
	runBenchmark,
} from "../scripts/benchmark-limits.ts";
import { encodeCalls, type Hex } from "../src/sdk/index.ts";

const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";
const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const initcodeBytes = hexSize(encodeCalls([]));
const config = {
	rpcUrl: "https://example.invalid/rpc",
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

test("parses CLI overrides, repeated flags, and environment configuration", () => {
	assert.deepEqual(
		parseBenchmarkArgs(
			[
				"--rpc-url",
				config.rpcUrl,
				"--mode=balances",
				`--token=${tokenA},${tokenB}`,
				"--owner",
				ownerA,
				"--owner",
				ownerB,
				"--block=123",
				`--from=${ownerA}`,
				"--gas=1000000",
				"--timeout-ms=1000",
				"--max-calls=200",
				"--max-initcode-bytes=0x100",
				"--max-runtime-bytes=0x200",
				"--json",
			],
			{ GHOSTCALL_BENCH_RPC_URL: "https://env.invalid/rpc" },
		),
		{
			help: false,
			config: {
				...config,
				tokens: [tokenA, tokenB],
				owners: [ownerA, ownerB],
				blockTag: "0x7b",
				gas: "0xf4240",
				timeoutMs: 1000,
				maxCalls: 200,
				maxInitcodeBytes: 256,
				maxRuntimeBytes: 512,
				json: true,
			},
		},
	);
	const parsed = parseBenchmarkArgs(["--mode=raw"], {
		GHOSTCALL_BENCH_RPC_URL: "https://env.invalid/rpc",
	});
	assert.ok(!parsed.help);
	assert.equal(parsed.config.rpcUrl, "https://env.invalid/rpc");
	assert.deepEqual(parsed.config.tokens, []);
	assert.deepEqual(parsed.config.owners, []);
});

test("rejects missing balance inputs, invalid addresses, and invalid numeric options", () => {
	const cases = [
		[["--mode=balances"], /token/i],
		[["--mode=balances", `--token=${tokenA}`], /owner/i],
		[
			["--mode=balances", "--token=0x1234", `--owner=${ownerA}`],
			/--token\[0\]/,
		],
		[
			["--mode=balances", `--token=${tokenA}`, "--owner=0x1234"],
			/--owner\[0\]/,
		],
		[["--mode=raw", "--from=0x1234"], /--from/],
		[
			["--mode=raw", "--gas=banana"],
			/--gas must be a non-negative safe integer/,
		],
		[
			["--mode=raw", "--max-calls=Infinity"],
			/--max-calls must be a non-negative safe integer/,
		],
		[
			["--mode=raw", "--timeout-ms"],
			/--timeout-ms must be a non-negative safe integer/,
		],
	] as const;
	for (const [args, error] of cases) {
		assert.throws(
			() =>
				parseBenchmarkArgs(args, { GHOSTCALL_BENCH_RPC_URL: config.rpcUrl }),
			error,
			args.join(" "),
		);
	}
});

test("builds exact probe bytes and validates balanceOf owners", () => {
	assert.equal(
		encodeBalanceOfCalldata(ownerA),
		`0x70a08231${"0".repeat(24)}${ownerA.slice(2)}`,
	);
	assert.throws(
		() => encodeBalanceOfCalldata("0x1234"),
		/owner must be a 20-byte hex string/,
	);
	assert.equal(hexSize(createRawInitcodeSizeProbe(10)), 10);
	assert.equal(createRawRuntimeReturnProbe(1), "0x60016000f3");
	assert.equal(createRawRuntimeReturnProbe(256), "0x6101006000f3");
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

test("rejects invalid benchmark inputs before any RPC", async (t) => {
	const fetch = t.mock.method(globalThis, "fetch", async () => {
		assert.fail("invalid balance inputs should not reach fetch");
	});
	await assert.rejects(
		runBenchmark({ ...config, owners: ["0x1234"] }),
		/config\.owners\[0\] must be a 20-byte hex string/,
	);
	assert.equal(fetch.mock.callCount(), 0);
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
	return `0x${`${success ? "8020" : "0020"}${"00".repeat(32)}`.repeat(count)}`;
}
