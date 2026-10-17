// One JSON line per event, so Brimble's log viewer can be searched by event name or
// request id. LOG_LEVEL: debug | info (default) | warn | error | silent.
const LEVELS = {debug: 10, info: 20, warn: 30, error: 40, silent: 100} as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

function threshold(): number {
	return LEVELS[(process.env.LOG_LEVEL ?? 'info') as keyof typeof LEVELS] ?? LEVELS.info;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
	if (LEVELS[level] < threshold()) return;
	const line = JSON.stringify({t: new Date().toISOString(), level, event, ...fields}, (_key, value) =>
		value instanceof Error ? {name: value.name, message: value.message} : value,
	);
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
}

export const logger = {
	debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
	info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
	warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
	error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
	isDebug: () => threshold() <= LEVELS.debug,
};

// Payment headers are signed authorizations: log that they exist, never their contents.
const REDACT = new Set(['payment-signature', 'x-payment', 'authorization', 'cookie']);

export function safeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(headers)) {
		out[key] = REDACT.has(key.toLowerCase()) ? `<redacted ${String(value ?? '').length} chars>` : value;
	}
	return out;
}
