import ecTwoSlash from "expressive-code-twoslash";

const plugin = ecTwoSlash({
	twoslashOptions: {
		// 0.6.1 creates a twoslasher per code block; a shared cache keeps each
		// block from building its own ~100 MB TypeScript environment.
		cache: new Map(),
		// Every example receives a provider without declaring one.
		extraFiles: {
			"client.d.ts":
				"declare const client: import('@volga-sh/evm-ghostcall').GhostcallProvider;",
		},
		compilerOptions: {
			// Paths resolve from docs/. Check examples against the SDK source,
			// and resolve its ox imports here because the docs build does not
			// install the root node_modules.
			paths: {
				"@volga-sh/evm-ghostcall": ["../src/sdk/index.ts"],
				"ox/*": ["node_modules/ox/dist/core/*.d.ts"],
			},
		},
	},
});

// Astro logs a Markdown page whose code block throws and builds it empty, so
// count failures and fail the build in `failOnTwoslashErrors`.
let failedBlocks = 0;

// Popups ship in the static HTML; keep their types and JSDoc out of search.
const popups = new Set([
	"twoslash-popup-container",
	"twoslash-static-container",
	"twoslash-completion-container",
]);

function excludePopupsFromSearch(node) {
	if (node.properties?.className?.some((name) => popups.has(name))) {
		node.properties.dataPagefindIgnore = "";
	} else {
		node.children?.forEach(excludePopupsFromSearch);
	}
}

/** Type-checks `ts twoslash` code blocks and renders their editor hovers. */
export const twoslash = {
	...plugin,
	hooks: {
		async preprocessCode(context) {
			try {
				await plugin.hooks.preprocessCode(context);
			} catch (error) {
				failedBlocks += 1;
				throw error;
			}
		},
		postprocessRenderedBlock({ renderData }) {
			excludePopupsFromSearch(renderData.blockAst);
		},
	},
};

export const failOnTwoslashErrors = {
	name: "fail-on-twoslash-errors",
	hooks: {
		"astro:build:done": () => {
			if (failedBlocks > 0) {
				throw new Error(`${failedBlocks} twoslash code block(s) failed`);
			}
		},
	},
};
