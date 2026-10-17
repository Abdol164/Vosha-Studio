// In-process render queue (MON-38). Remotion renders are CPU/RAM heavy, so at most
// MAX_CONCURRENT_RENDERS (1 or 2) run at once and a short line waits behind them. Once
// more than MAX_WAITING jobs are waiting, new work is refused with QueueFullError so
// the route can answer 503 — ideally via isFull() before payment is taken.

export const MAX_WAITING = 5;

export class QueueFullError extends Error {
	constructor() {
		super('render queue is full');
		this.name = 'QueueFullError';
	}
}

export function concurrencyFromEnv(raw = process.env.MAX_CONCURRENT_RENDERS): number {
	const n = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.min(n, 2);
}

export class RenderQueue {
	private running = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(
		readonly concurrency = concurrencyFromEnv(),
		readonly maxWaiting = MAX_WAITING,
	) {}

	get stats() {
		return {running: this.running, waiting: this.waiting.length, concurrency: this.concurrency};
	}

	// True when a new job would be refused. Advisory only: another request can take the
	// last slot between this check and run(), so run() enforces it again.
	isFull(): boolean {
		return this.running >= this.concurrency && this.waiting.length >= this.maxWaiting;
	}

	async run<T>(job: () => Promise<T>): Promise<T> {
		if (this.running >= this.concurrency) {
			if (this.waiting.length >= this.maxWaiting) {
				throw new QueueFullError();
			}
			// A finishing job hands its slot straight to us (running is not decremented),
			// so nobody can jump the line between its release and our start.
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		} else {
			this.running++;
		}
		try {
			return await job();
		} finally {
			const next = this.waiting.shift();
			if (next) {
				next();
			} else {
				this.running--;
			}
		}
	}
}

export const renderQueue = new RenderQueue();
