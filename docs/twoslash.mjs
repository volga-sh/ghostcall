import { selectAll } from "expressive-code/hast";
import ecTwoSlash from "expressive-code-twoslash";

const plugin = ecTwoSlash({
	twoslashOptions: {
		// Version 0.6.1 makes one twoslasher for each code block.
		// Use one cache for all code blocks.
		// The cache keeps one TypeScript environment of approximately 100 MB.
		cache: new Map(),
		// This file supplies a provider for each example.
		extraFiles: {
			"client.d.ts":
				"declare const client: import('@volga-sh/evm-ghostcall').GhostcallProvider;",
		},
		compilerOptions: {
			// Paths start in docs/. Do a check of the examples against the SDK source.
			// The docs build does not install node_modules from the repository root.
			// Get the ox imports from docs/node_modules.
			paths: {
				"@volga-sh/evm-ghostcall": ["../src/sdk/index.ts"],
				"ox/*": ["node_modules/ox/dist/core/*.d.ts"],
			},
		},
	},
});

// Astro writes a log when a code block throws an error.
// It then makes an empty Markdown page.
// Count these failures. Stop the build in `failOnTwoslashErrors`.
let failedBlocks = 0;

/** Does a type check of `ts twoslash` blocks. Shows type information in popups. */
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
			// The static HTML contains popups. Keep their types and JSDoc out of search results.
			for (const node of selectAll(
				".twoslash-popup-container, .twoslash-static-container, .twoslash-completion-container",
				renderData.blockAst,
			)) {
				node.properties.dataPagefindIgnore = "";
			}
		},
	},
};

export const failOnTwoslashErrors = {
	name: "fail-on-twoslash-errors",
	hooks: {
		"astro:build:done": () => {
			if (failedBlocks > 0) {
				throw new Error(`${failedBlocks} code blocks failed in twoslash`);
			}
		},
	},
};
