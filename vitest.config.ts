import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// n8n runs nodes as CommonJS; test against the same build of n8n-workflow.
		alias: [
			{
				find: /^n8n-workflow$/,
				replacement: new URL('./node_modules/n8n-workflow/dist/cjs/index.js', import.meta.url)
					.pathname,
			},
		],
	},
	test: {
		include: ['test/**/*.test.ts'],
	},
});
