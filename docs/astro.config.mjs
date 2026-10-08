import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { failOnTwoslashErrors, twoslash } from "./twoslash.mjs";

const site = "https://ghostcall.volga.sh";
const socialImage = new URL("/og.png", site).href;
const socialImageAlt =
	"ghostcall documentation: Batch reads through one eth_call.";

export default defineConfig({
	site,
	// Preserve spacing between inline elements after Astro 7 changed the default.
	compressHTML: true,
	integrations: [
		starlight({
			title: "ghostcall",
			description: "Batch contract reads through one CREATE-style eth_call.",
			tableOfContents: false,
			expressiveCode: {
				themes: ["github-light"],
				useStarlightDarkModeSwitch: false,
				styleOverrides: {
					frames: {
						editorBackground: "var(--gc-code)",
						terminalBackground: "var(--gc-code)",
						editorActiveTabBackground: "var(--gc-code)",
						inlineButtonBackground: "var(--gc-surface)",
						inlineButtonForeground: "var(--gc-code-ink)",
						frameBoxShadowCssValue: "none",
					},
					twoSlash: {
						background: "var(--gc-surface)",
						borderColor: "var(--gc-rule-strong)",
						textColor: "var(--gc-code-ink)",
						hoverUnderlineColor: "var(--gc-rule-strong)",
						tagColor: "var(--gc-accent-deep)",
						linkColor: "var(--gc-accent)",
						linkColorHover: "var(--gc-accent-deep)",
						linkColorVisited: "var(--gc-accent)",
						linkColorActive: "var(--gc-accent-deep)",
						cursorColor: "var(--gc-accent)",
						completionBoxBackground: "var(--gc-surface)",
						completionBoxBorder: "var(--gc-rule-strong)",
						completionBoxColor: "var(--gc-code-ink)",
						completionBoxMatchedColor: "var(--gc-accent)",
						completionBoxHoverBackground: "var(--gc-accent-soft)",
						completionIconString: "var(--gc-muted)",
					},
				},
				plugins: [twoslash],
			},
			head: [
				{
					tag: "meta",
					attrs: { name: "color-scheme", content: "light" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image", content: socialImage },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:secure_url", content: socialImage },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:type", content: "image/png" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:width", content: "1200" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:height", content: "630" },
				},
				{
					tag: "meta",
					attrs: {
						property: "og:image:alt",
						content: socialImageAlt,
					},
				},
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
				},
				{
					tag: "meta",
					attrs: { name: "twitter:image", content: socialImage },
				},
				{
					tag: "meta",
					attrs: {
						name: "twitter:image:alt",
						content: socialImageAlt,
					},
				},
			],
			customCss: ["./src/styles/volga.css"],
			components: {
				Footer: "./src/components/Footer.astro",
				Header: "./src/components/Header.astro",
				Hero: "./src/components/Hero.astro",
				PageTitle: "./src/components/PageTitle.astro",
				ThemeProvider: "./src/components/LightTheme.astro",
				ThemeSelect: "./src/components/NoThemeSelect.astro",
			},
			editLink: {
				baseUrl: "https://github.com/volga-sh/ghostcall/edit/main/docs/",
			},
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/volga-sh/ghostcall",
				},
			],
			sidebar: [
				{
					label: "Guides",
					items: [{ label: "Getting Started", slug: "getting-started" }],
				},
				{
					label: "API",
					items: [
						{ label: "Overview", slug: "api" },
						{
							label: "aggregateDecodedCalls",
							slug: "api/aggregate-decoded-calls",
						},
						{ label: "aggregateCalls", slug: "api/aggregate-calls" },
						{ label: "encodeCalls", slug: "api/encode-calls" },
						{ label: "decodeResults", slug: "api/decode-results" },
						{ label: "GhostcallSubcallError", slug: "api/subcall-error" },
						{ label: "Types", slug: "api/types" },
					],
				},
				{
					label: "How It Works",
					items: [
						{ label: "Protocol", slug: "protocol" },
						{ label: "Limits", slug: "limits" },
					],
				},
				{
					label: "Contribute",
					items: [{ label: "Development", slug: "development" }],
				},
			],
		}),
		failOnTwoslashErrors,
	],
});
