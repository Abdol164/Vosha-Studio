// Side-effect import: loads .env into process.env. Needed because tsx (unlike bun)
// does not auto-load .env — every tsx-run entry point (render-local.ts, pay-test.ts,
// the eventual server.ts) must import this first, or env-dependent code (copywriter,
// voiceover, x402 config, ...) silently falls back or breaks with no visible error.
// Safe to import from an already-bun-loaded context too: re-parsing the same file is
// harmless.
try {
	process.loadEnvFile();
} catch (err) {
	// No .env file is fine (e.g. CI with real env vars already set); anything else
	// (bad syntax, permissions) is worth surfacing.
	if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
		throw err;
	}
}

// Hosting dashboards (Brimble, Coolify) take values literally, so pasting a line from
// .env.example brings its inline comment along: X402_NETWORK arrived in production as
// "base-sepolia            # base-sepolia | base". Strip a whitespace-preceded "#..." tail;
// none of our values (URLs, 0x addresses, API keys) contain " #".
export function stripInlineComment(value: string): string {
	return value.replace(/\s+#.*$/s, '').trim();
}

for (const [key, value] of Object.entries(process.env)) {
	if (value !== undefined && /\s#/.test(value)) {
		process.env[key] = stripInlineComment(value);
	}
}
