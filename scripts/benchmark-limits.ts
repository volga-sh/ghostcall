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
	ghostcallInitcodeBytes: number;
	rawInitcode: LimitResult | null;
	rawRuntime: LimitResult | null;
	balances:
		| (LimitResult & { fullCreateDataBytes: number; returnedBytes: number })
		| null;
};

// [uint16 length][20-byte target][4-byte selector][32-byte owner word]
const balanceInputBytesPerCall = 2 + 20 + 4 + 32;
// [2-byte header][32-byte uint256]
const balanceReturnedBytesPerCall = 2 + 32;
// PUSH1 0 PUSH1 0 RETURN: initcode that returns empty runtime code.
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

/**
 * Initcode of exactly `sizeBytes`: empty-runtime code plus unreachable zero
 * padding. findLimit starts at the 5-byte prefix, so sizes are never smaller.
 */
function createRawInitcodeSizeProbe(sizeBytes: number): Hex {
	const paddingBytes = sizeBytes - emptyRuntimeInitcode.length / 2;
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
 * Find the largest passing candidate: double from `min` until a probe fails or
 * reaches `max`, then binary-search the gap. `probe` returns null on success or
 * a short failure reason; unexpected conditions should throw.
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
	const ethCall = {
		from: config.from,
		...(config.gas !== undefined && { gas: config.gas }),
	};
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

	// Fail fast on an unreachable endpoint before running any probes.
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

/** Human-readable report. It omits the RPC URL so provider keys are not printed. */
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
				: `max pass: ${format(result.maxPass)} ${unit}; first fail ${format(result.firstFail ?? 0)} ${unit}`,
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
