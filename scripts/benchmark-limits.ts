import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { RpcTransport } from "ox";
import { validate as isAddress } from "ox/Address";
import { size as hexSize } from "ox/Hex";
import { ghostcallInitcode } from "../src/sdk/generated/initcode.ts";

import {
	decodeResults,
	encodeCalls,
	type GhostcallCall,
	type GhostcallProvider,
	type Hex,
} from "../src/sdk/index.ts";

/**
 * These fields match the CLI flags.
 * Each size limit stops the search.
 * The search limit is not a chain limit.
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
	ghostcallInitcodeBytes: number;
	rawInitcode: LimitResult | null;
	rawRuntime: LimitResult | null;
	balances:
		| (LimitResult & { fullCreateDataBytes: number; returnedBytes: number })
		| null;
};

// [uint16 length][20-byte address][4-byte selector][32-byte owner word]
const balanceInputBytesPerCall = 2 + 20 + 4 + 32;
// [2-byte result header][32-byte uint256]
const balanceReturnedBytesPerCall = 2 + 32;
// The initcode `PUSH1 0 PUSH1 0 RETURN` returns an empty runtime.
const emptyRuntimeInitcode = "60006000f3";
const format = new Intl.NumberFormat("en-US").format;

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

/**
 * Parse the CLI flags and the default values from the environment.
 * Do an address check before the RPC request.
 */
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
		throw new Error("Supply --rpc-url or set GHOSTCALL_BENCH_RPC_URL.");
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
			throw new Error(
				`Supply at least one --${name} address for balance mode.`,
			);
		}
		return list.map((address, index) =>
			assertAddress(address, `--${name}[${index}]`),
		);
	};
	const integer = (
		name:
			| "gas"
			| "timeout-ms"
			| "max-calls"
			| "max-initcode-bytes"
			| "max-runtime-bytes",
	): number => {
		const raw = values[name] ?? "";
		const value = Number(raw);
		if (raw.trim() === "" || !Number.isSafeInteger(value) || value < 0) {
			throw new Error(
				`--${name} must be a non-negative safe integer, got "${raw}"`,
			);
		}
		return value;
	};

	return {
		rpcUrl,
		mode,
		tokens: addresses("token", "GHOSTCALL_BENCH_TOKENS"),
		owners: addresses("owner", "GHOSTCALL_BENCH_OWNERS"),
		blockTag: /^\d+$/.test(values.block)
			? `0x${BigInt(values.block).toString(16)}`
			: values.block,
		from: assertAddress(values.from, "--from"),
		...(values.gas !== undefined && {
			gas: `0x${integer("gas").toString(16)}`,
		}),
		timeoutMs: integer("timeout-ms"),
		maxCalls: integer("max-calls"),
		maxInitcodeBytes: integer("max-initcode-bytes"),
		maxRuntimeBytes: integer("max-runtime-bytes"),
		json: values.json,
	};
}

/**
 * Build `count` calls to `balanceOf(address)` with explicit byte encoding.
 * Change the token index before you change the owner index.
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

/**
 * Build initcode with exactly `sizeBytes` bytes.
 * Put zero padding after the code that returns an empty runtime.
 * The padding does not run.
 * `findLimit` starts at the 5-byte prefix.
 * It does not request a smaller size.
 */
function createRawInitcodeSizeProbe(sizeBytes: number): Hex {
	const paddingBytes = sizeBytes - emptyRuntimeInitcode.length / 2;
	return `0x${emptyRuntimeInitcode}${"00".repeat(paddingBytes)}`;
}

/** Use `PUSHn size PUSH1 0 RETURN` to return `sizeBytes` zero bytes. */
function createRawRuntimeReturnProbe(sizeBytes: number): Hex {
	const size = sizeBytes.toString(16);
	const evenSize = size.length % 2 === 0 ? size : `0${size}`;
	const pushOpcode = (0x5f + evenSize.length / 2).toString(16);
	return `0x${pushOpcode}${evenSize}6000f3`;
}

/**
 * Find the largest candidate that returns success.
 * Double the size from `min` until a probe returns failure or reaches `max`.
 * Then use a binary search between these values.
 * The probe returns `null` for success or a short reason for failure.
 * Throw an error for other conditions.
 */
async function findLimit(
	min: number,
	max: number,
	probe: (candidate: number) => Promise<string | null>,
): Promise<LimitResult> {
	const result: LimitResult = {
		maxPass: min - 1,
		firstFail: null,
		exhaustedConfiguredMax: false,
		configuredMax: max,
		attempts: 0,
		failure: null,
	};
	if (max < min) {
		const failure = `configured max ${max} is below minimum candidate ${min}`;
		return { ...result, firstFail: min, failure };
	}
	const passes = async (candidate: number): Promise<boolean> => {
		result.attempts += 1;
		const failure = await probe(candidate);
		if (failure === null) result.maxPass = candidate;
		else Object.assign(result, { firstFail: candidate, failure });
		return failure === null;
	};

	let candidate = min;
	while ((await passes(candidate)) && candidate < max) {
		candidate = Math.min(candidate * 2, max);
	}
	let low = result.maxPass + 1;
	let high = (result.firstFail ?? max + 1) - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (await passes(middle)) low = middle + 1;
		else high = middle - 1;
	}
	result.exhaustedConfiguredMax = result.firstFail === null;
	return result;
}

/**
 * Run the selected probes at one endpoint.
 * Raw probes measure the CREATE limits for input and output.
 * Balance probes measure a ghostcall batch.
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
	const ethCall = {
		from: config.from,
		...(config.gas !== undefined && { gas: config.gas }),
	};
	// Use RPC errors as probe failures.
	// The `check` callback compares the result with the expected value.
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

	// Make sure that the endpoint answers before you run the probes.
	const chainId = await rpc("eth_chainId", []);
	const latestBlock = await rpc("eth_blockNumber", []);
	const ghostcallInitcodeBytes = hexSize(ghostcallInitcode);
	const runsRaw = config.mode !== "balances";
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
	const balanceCallsByInitcode = Math.floor(
		(config.maxInitcodeBytes - ghostcallInitcodeBytes) /
			balanceInputBytesPerCall,
	);
	const balances =
		config.mode === "raw"
			? null
			: await findLimit(
					1,
					Math.min(config.maxCalls, balanceCallsByInitcode),
					(count) =>
						probe(
							encodeCalls(
								buildBalanceCalls(count, config.tokens, config.owners),
								{ maxInitcodeBytes: config.maxInitcodeBytes },
							),
							(result) => balanceFailure(result, count),
						),
				);

	return {
		chainId,
		latestBlock,
		blockTag: config.blockTag,
		from: config.from,
		gas: config.gas ?? null,
		ghostcallInitcodeBytes,
		rawInitcode,
		rawRuntime,
		balances: balances && {
			...balances,
			fullCreateDataBytes:
				ghostcallInitcodeBytes + balances.maxPass * balanceInputBytesPerCall,
			returnedBytes: balances.maxPass * balanceReturnedBytesPerCall,
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
	for (const [index, { success, returnData }] of entries.entries()) {
		if (!success)
			return `balanceOf call ${index} returned a failed result entry`;
		if (hexSize(returnData) !== 32) {
			throw new Error(
				`balanceOf call ${index} returned ${hexSize(returnData)} bytes`,
			);
		}
	}
	return null;
}

/**
 * Give a report in text format.
 * Do not print the RPC URL because it can contain provider keys.
 */
function formatBenchmarkReport(report: BenchmarkReport): string {
	const lines = [
		"ghostcall limit benchmark",
		`chain id: ${report.chainId}`,
		`latest observed block: ${report.latestBlock}`,
		`block tag: ${report.blockTag}`,
		`from: ${report.from}`,
		`gas: ${report.gas ?? "provider default"}`,
		`ghostcall initcode: ${format(report.ghostcallInitcodeBytes)} bytes`,
	];
	const sections = [
		["raw initcode size", report.rawInitcode, "bytes"],
		["raw returned runtime code", report.rawRuntime, "bytes"],
		["ERC-20 balanceOf ghostcall batch", report.balances, "calls"],
	] as const;
	for (const [title, result, unit] of sections) {
		if (result === null) continue;
		lines.push(
			"",
			title,
			result.exhaustedConfiguredMax
				? `max pass: >= ${format(result.maxPass)} ${unit}`
				: `max pass: ${format(result.maxPass)} ${unit}. First failure ${format(result.firstFail ?? 0)} ${unit}`,
			`attempts: ${format(result.attempts)}`,
			`first failure: ${result.failure ?? "none before configured max"}`,
		);
	}
	if (report.balances !== null) {
		lines.push(
			`full CREATE data: ${format(report.balances.fullCreateDataBytes)} bytes`,
			`returned bytes: ${format(report.balances.returnedBytes)} bytes`,
			`per call input/return: ${balanceInputBytesPerCall}/${balanceReturnedBytesPerCall} bytes`,
		);
	}
	return lines.join("\n");
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
