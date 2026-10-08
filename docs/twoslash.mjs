import { fileURLToPath } from "node:url";
import ecTwoSlash from "expressive-code-twoslash";

const resolvePath = (relativePath) =>
	fileURLToPath(new URL(relativePath, import.meta.url));

const plugin = ecTwoSlash({
	twoslashOptions: {
		compilerOptions: {
			// The SDK imports its own modules with `.ts` extensions.
			allowImportingTsExtensions: true,
			noEmit: true,
			paths: {
				// Check examples against the SDK source, not the last release.
				"@volga-sh/evm-ghostcall": [resolvePath("../src/sdk/index.ts")],
				// The SDK source would otherwise resolve ox from the root
				// node_modules, which the docs build does not install.
				ox: [resolvePath("node_modules/ox")],
				"ox/*": [resolvePath("node_modules/ox/dist/core/*.d.ts")],
			},
		},
	},
});

// Astro logs a Markdown page whose code block throws, then builds that page
// empty, so a type error in an example would not fail `astro build` by itself.
let failedBlocks = 0;

// Popups ship in the static HTML. Without this, Pagefind indexes every type
// signature and JSDoc comment as page text.
const popupClassNames = [
	"twoslash-popup-container",
	"twoslash-static",
	"twoslash-completion-container",
];

function excludePopupsFromSearch(node) {
	const classNames = node.properties?.className;
	if (classNames?.some((name) => popupClassNames.includes(name))) {
		node.properties.dataPagefindIgnore = "";
		return;
	}
	for (const child of node.children ?? []) excludePopupsFromSearch(child);
}

/** Type-checks `ts twoslash` code blocks and renders their editor hovers. */
const twoslash = {
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

/** Fails `astro build` after rendering if any `ts twoslash` block failed. */
const failOnTwoslashErrors = {
	name: "fail-on-twoslash-errors",
	hooks: {
		"astro:build:done": () => {
			if (failedBlocks > 0) {
				throw new Error(
					`${failedBlocks} twoslash code block(s) failed to render; see the errors above.`,
				);
			}
		},
	},
};

export { failOnTwoslashErrors, twoslash };
