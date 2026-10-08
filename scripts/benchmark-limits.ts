import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { RpcTransport } from "ox";
import { validate as isAddress } from "ox/Address";
import { size as hexSize } from "ox/Hex";

import {
	decodeResults,
	encodeCalls,
	type GhostcallCall,
	type GhostcallProvider,
	type Hex,
} from "../src/sdk/index.ts";

/**
 * Mirrors the CLI flags one-to-one. Each size cap is a search ceiling, not a
 * claimed chain limit.
 */
type BenchmarkConfig = {
	rpcUrl: string;
	mode: "raw" | "balances" | "all";
	tokens: readonly Hex[];
	owners: readonly Hex[];
	blockTag: string;
	from: Hex;
	gas?: Hex;
	timeoutMs: number;
	maxCalls: number;
	maxInitcodeBytes: number;
	maxRuntimeBytes: number;
	json: boolean;
};

type LimitResult = {
	maxPass: number;
	firstFail: number | null;
	exhaustedConfiguredMax: boolean;
	configuredMax: number;
	attempts: number;
	failure: string | null;
};

type BenchmarkReport = {
	chainId: Hex;
	latestBlock: Hex;
	blockTag: string;
	from: Hex;
	gas: Hex | null;
	timeoutMs: number;
	ghostcallInitcodeBytes: number;
	rawInitcode: LimitResult | null;
	rawRuntime: LimitResult | null;
	balances:
		| (LimitResult & {
				tokenCount: number;
				ownerCount: number;
				fullCreateDataBytes: number;
				returnedBytes: number;
				inputBytesPerCall: number;
				returnedBytesPerCall: number;
		  })
		| null;
};

// [uint16 length][20-byte target][4-byte selector][32-byte owner word]
const balanceInputBytesPerCall = 2 + 20 + 4 + 32;
// [2-byte header][32-byte uint256]
const balanceReturnedBytesPerCall = 2 + 32;
// PUSH1 0 PUSH1 0 RETURN: initcode that returns empty runtime code.
const emptyRuntimeInitcode = "60006000f3";
const prettyInteger = new Intl.NumberFormat("en-US");

const usage = `Usage:
  npm run benchmark:limits -- --rpc-url <url> --mode raw
  npm run benchmark:limits -- --rpc-url <url> --token <address> --owner <address>

Options:
  --rpc-url <url>              JSON-RPC endpoint, or GHOSTCALL_BENCH_RPC_URL
  --mode raw|balances|all      Probe mode (default: all)
  --token <addresses>          Repeatable or comma-separated token addresses, or GHOSTCALL_BENCH_TOKENS
  --owner <addresses>          Repeatable or comma-separated owner addresses, or GHOSTCALL_BENCH_OWNERS
  --block <tag|number>         Block tag or decimal block number (default: latest)
  --from <address>             eth_call sender (default: zero address)
  --gas <quantity>             Optional eth_call gas
  --timeout-ms <ms>            Per-request timeout (default: 30000)
  --max-calls <count>          Balance benchmark search ceiling (default: 10000)
  --max-initcode-bytes <bytes> Raw initcode and balance CREATE-data ceiling (default: 524288)
  --max-runtime-bytes <bytes>  Raw returned-code search ceiling (default: 524288)
  --json                       Print machine-readable JSON`;

/** Parse CLI flags and environment fallbacks, validating addresses before any RPC. */
function parseBenchmarkArgs(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): BenchmarkConfig {
	const { values } = parseArgs({
		args: [...argv],
		options: {
			"rpc-url": { type: "string" },
			mode: { type: "string", default: "all" },
			token: { type: "string", multiple: true },
			owner: { type: "string", multiple: true },
			block: { type: "string", default: "latest" },
			from: {
				type: "string",
				default: "0x0000000000000000000000000000000000000000",
			},
			gas: { type: "string" },
			"timeout-ms": { type: "string", default: "30000" },
			"max-calls": { type: "string", default: "10000" },
			"max-initcode-bytes": { type: "string", default: "524288" },
			"max-runtime-bytes": { type: "string", default: "524288" },
			json: { type: "boolean", default: false },
		},
	});

	const rpcUrl = values["rpc-url"] ?? env.GHOSTCALL_BENCH_RPC_URL;
	if (!rpcUrl) {
		throw new Error(
			"Missing RPC URL. Pass --rpc-url or set GHOSTCALL_BENCH_RPC_URL.",
		);
	}
	const { mode } = values;
	if (mode !== "raw" && mode !== "balances" && mode !== "all") {
		throw new Error("--mode must be raw, balances, or all.");
	}

	const addresses = (name: "token" | "owner", envName: string): Hex[] => {
		if (mode === "raw") return [];
		const list = (values[name] ?? [env[envName] ?? ""])
			.flatMap((value) => value.split(","))
			.map((word) => word.trim())
			.filter(Boolean);
		if (list.length === 0) {
			throw new Error(`Balance mode requires at least one --${name} address.`);
		}
		return list.map((address, index) =>
			assertAddress(address, `--${name}[${index}]`),
		);
	};
	const integer = (name: keyof typeof values, raw: string): number => {
		const value = Number(raw);
		if (raw.trim() === "" || !Number.isSafeInteger(value) || value < 0) {
			throw new Error(
				`--${name} must be a non-negative safe integer, got "${raw}"`,
			);
		}
		return value;
	};

	const config: BenchmarkConfig = {
		rpcUrl,
		mode,
		tokens: addresses("token", "GHOSTCALL_BENCH_TOKENS"),
		owners: addresses("owner", "GHOSTCALL_BENCH_OWNERS"),
		blockTag: /^\d+$/.test(values.block)
			? `0x${BigInt(values.block).toString(16)}`
			: values.block,
		from: assertAddress(values.from, "--from"),
		timeoutMs: integer("timeout-ms", values["timeout-ms"]),
		maxCalls: integer("max-calls", values["max-calls"]),
		maxInitcodeBytes: integer(
			"max-initcode-bytes",
			values["max-initcode-bytes"],
		),
		maxRuntimeBytes: integer("max-runtime-bytes", values["max-runtime-bytes"]),
		json: values.json,
	};
	if (values.gas !== undefined) {
		config.gas = `0x${integer("gas", values.gas).toString(16)}`;
	}
	return config;
}

/**
 * Build `count` hand-encoded `balanceOf(address)` calls so the byte math stays
 * visible. Tokens rotate fastest: token 0/owner 0, token 1/owner 0, token 0/owner 1.
 */
function buildBalanceCalls(
	count: number,
	tokens: readonly Hex[],
	owners: readonly Hex[],
): GhostcallCall[] {
	return Array.from({ length: count }, (_, index) => {
		const owner = owners[
			Math.floor(index / tokens.length) % owners.length
		] as Hex;
		return {
			to: tokens[index % tokens.length] as Hex,
			data: `0x70a08231${owner.slice(2).padStart(64, "0")}`,
		};
	});
}

/** Initcode of exactly `sizeBytes`: empty-runtime code plus unreachable zero padding. */
function createRawInitcodeSizeProbe(sizeBytes: number): Hex {
	const paddingBytes = sizeBytes - emptyRuntimeInitcode.length / 2;
	if (!Number.isSafeInteger(paddingBytes) || paddingBytes < 0) {
		throw new RangeError(
			`sizeBytes must be an integer >= ${emptyRuntimeInitcode.length / 2}`,
		);
	}
	return `0x${emptyRuntimeInitcode}${"00".repeat(paddingBytes)}`;
}

/** Initcode `PUSHn size PUSH1 0 RETURN`, returning `sizeBytes` zeroed bytes. */
function createRawRuntimeReturnProbe(sizeBytes: number): Hex {
	const size = sizeBytes.toString(16);
	const evenSize = size.length % 2 === 0 ? size : `0${size}`;
	const pushOpcode = (0x5f + evenSize.length / 2).toString(16);
	return `0x${pushOpcode}${evenSize}6000f3`;
}

/**
 * Find the largest passing candidate with exponential then binary search.
 * `probe` returns null on success or a short failure reason; unexpected
 * conditions should throw so bad inputs stay separate from size failures.
 */
async function findLimit(
	min: number,
	max: number,
	probe: (candidate: number) => Promise<string | null>,
): Promise<LimitResult> {
	if (max < min) {
		return {
			maxPass: min - 1,
			firstFail: min,
			exhaustedConfiguredMax: false,
			configuredMax: max,
			attempts: 0,
			failure: `configured max ${max} is below minimum candidate ${min}`,
		};
	}

	let attempts = 0;
	let maxPass = min - 1;
	let firstFail: number | null = null;
	let failure: string | null = null;

	for (let candidate = min; ; candidate = Math.min(candidate * 2, max)) {
		attempts += 1;
		failure = await probe(candidate);
		if (failure !== null) {
			firstFail = candidate;
			break;
		}
		maxPass = candidate;
		if (candidate === max) {
			return {
				maxPass,
				firstFail: null,
				exhaustedConfiguredMax: true,
				configuredMax: max,
				attempts,
				failure: null,
			};
		}
	}

	let low = maxPass + 1;
	let high = firstFail - 1;
	while (low <= high) {
		const candidate = Math.floor((low + high) / 2);
		attempts += 1;
		const candidateFailure = await probe(candidate);
		if (candidateFailure === null) {
			maxPass = candidate;
			low = candidate + 1;
		} else {
			firstFail = candidate;
			failure = candidateFailure;
			high = candidate - 1;
		}
	}

	return {
		maxPass,
		firstFail,
		exhaustedConfiguredMax: false,
		configuredMax: max,
		attempts,
		failure,
	};
}

/**
 * Run the selected probes against one endpoint. Raw probes isolate the CREATE
 * input and output ceilings; balance probes measure a real ghostcall workload.
 */
async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkReport> {
	const provider: GhostcallProvider = RpcTransport.fromHttp(config.rpcUrl, {
		timeout: config.timeoutMs,
	});
	const rpc = async (
		method: string,
		params: readonly unknown[],
	): Promise<Hex> => {
		const result = await provider.request({ method, params });
		if (typeof result !== "string") {
			throw new Error(`${method} returned a non-string result`);
		}
		return result as Hex;
	};
	const ethCall: { from: Hex; gas?: Hex } = { from: config.from };
	if (config.gas !== undefined) ethCall.gas = config.gas;
	// RPC errors are probe failures; `check` decides whether the result passes.
	const probe = async (
		data: Hex,
		check: (result: Hex) => string | null,
	): Promise<string | null> => {
		let result: Hex;
		try {
			result = await rpc("eth_call", [{ ...ethCall, data }, config.blockTag]);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		return check(result);
	};

	const chainId = await rpc("eth_chainId", []);
	const latestBlock = await rpc("eth_blockNumber", []);
	const ghostcallInitcodeBytes = hexSize(encodeCalls([]));
	const runsRaw = config.mode !== "balances";
	const runsBalances = config.mode !== "raw";

	const rawInitcode = runsRaw
		? await findLimit(
				emptyRuntimeInitcode.length / 2,
				config.maxInitcodeBytes,
				(size) =>
					probe(createRawInitcodeSizeProbe(size), (result) =>
						result === "0x"
							? null
							: `expected 0x, received ${hexSize(result)} bytes`,
					),
			)
		: null;

	const rawRuntime = runsRaw
		? await findLimit(1, config.maxRuntimeBytes, (size) =>
				probe(createRawRuntimeReturnProbe(size), (result) =>
					hexSize(result) === size
						? null
						: `expected ${size} returned bytes, received ${hexSize(result)}`,
				),
			)
		: null;

	const maxBalanceCallsByInitcode = Math.max(
		0,
		Math.floor(
			(config.maxInitcodeBytes - ghostcallInitcodeBytes) /
				balanceInputBytesPerCall,
		),
	);
	const balanceLimit = runsBalances
		? await findLimit(
				1,
				Math.min(config.maxCalls, maxBalanceCallsByInitcode),
				(count) =>
					probe(
						encodeCalls(
							buildBalanceCalls(count, config.tokens, config.owners),
							{ maxInitcodeBytes: config.maxInitcodeBytes },
						),
						(result) => balanceFailure(result, count),
					),
			)
		: null;

	return {
		chainId,
		latestBlock,
		blockTag: config.blockTag,
		from: config.from,
		gas: config.gas ?? null,
		timeoutMs: config.timeoutMs,
		ghostcallInitcodeBytes,
		rawInitcode,
		rawRuntime,
		balances:
			balanceLimit === null
				? null
				: {
						...balanceLimit,
						tokenCount: config.tokens.length,
						ownerCount: config.owners.length,
						fullCreateDataBytes:
							ghostcallInitcodeBytes +
							balanceLimit.maxPass * balanceInputBytesPerCall,
						returnedBytes: balanceLimit.maxPass * balanceReturnedBytesPerCall,
						inputBytesPerCall: balanceInputBytesPerCall,
						returnedBytesPerCall: balanceReturnedBytesPerCall,
					},
	};
}

function balanceFailure(result: Hex, count: number): string | null {
	const entries = decodeResults(result);
	if (entries.length !== count) {
		throw new Error(
			`expected ${count} result entries, received ${entries.length}`,
		);
	}
	for (const [index, entry] of entries.entries()) {
		if (!entry.success) {
			return `balanceOf call ${index} returned a failed result entry`;
		}
		if (hexSize(entry.returnData) !== 32) {
			throw new Error(
				`balanceOf call ${index} returned ${hexSize(entry.returnData)} bytes instead of 32`,
			);
		}
	}
	return null;
}

/** Human-readable report. It omits the RPC URL so provider keys are not printed. */
function formatBenchmarkReport(report: BenchmarkReport): string {
	const lines = [
		"ghostcall limit benchmark",
		`chain id: ${report.chainId}`,
		`latest observed block: ${report.latestBlock}`,
		`block tag: ${report.blockTag}`,
		`from: ${report.from}`,
		`gas: ${report.gas ?? "provider default"}`,
		`timeout: ${format(report.timeoutMs)} ms`,
		`ghostcall initcode: ${format(report.ghostcallInitcodeBytes)} bytes`,
	];
	if (report.rawInitcode !== null) {
		lines.push(
			"",
			"raw initcode size",
			formatLimit(report.rawInitcode, "bytes"),
		);
	}
	if (report.rawRuntime !== null) {
		lines.push(
			"",
			"raw returned runtime code",
			formatLimit(report.rawRuntime, "bytes"),
		);
	}
	if (report.balances !== null) {
		const { balances } = report;
		lines.push(
			"",
			"ERC-20 balanceOf ghostcall batch",
			`token inputs: ${format(balances.tokenCount)}`,
			`owner inputs: ${format(balances.ownerCount)}`,
			formatLimit(balances, "calls"),
			`full CREATE data: ${format(balances.fullCreateDataBytes)} bytes`,
			`returned bytes: ${format(balances.returnedBytes)} bytes`,
			`per call input/return: ${balances.inputBytesPerCall}/${balances.returnedBytesPerCall} bytes`,
		);
	}
	return lines.join("\n");
}

function formatLimit(result: LimitResult, unit: string): string {
	const limit = result.exhaustedConfiguredMax
		? `max pass: >= ${format(result.maxPass)} ${unit}`
		: `max pass: ${format(result.maxPass)} ${unit}; first fail ${format(result.firstFail ?? 0)} ${unit}`;
	return [
		limit,
		`attempts: ${format(result.attempts)}`,
		`first failure: ${result.failure ?? "none before configured max"}`,
	].join("\n");
}

function format(value: number): string {
	return prettyInteger.format(value);
}

function assertAddress(value: string, label: string): Hex {
	if (!isAddress(value, { strict: false })) {
		throw new TypeError(`${label} must be a 20-byte hex string`);
	}
	return value;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(usage);
		return;
	}
	const config = parseBenchmarkArgs(argv);
	const report = await runBenchmark(config);
	console.log(
		config.json
			? JSON.stringify(report, null, 2)
			: formatBenchmarkReport(report),
	);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

export type { BenchmarkConfig };
export {
	balanceInputBytesPerCall,
	buildBalanceCalls,
	createRawInitcodeSizeProbe,
	createRawRuntimeReturnProbe,
	findLimit,
	parseBenchmarkArgs,
	runBenchmark,
};
