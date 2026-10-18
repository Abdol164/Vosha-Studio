import {randomBytes} from 'node:crypto';
import express, {type ErrorRequestHandler, type RequestHandler} from 'express';
import type {DropCopy, StatusDropProps} from '../remotion/types.js';
import type {writeCopy as WriteCopyFn} from './copywriter.js';
import {runDropJob} from './drop-job.js';
import type {MusicTrack} from './music.js';
import type {fetchPhoto as FetchPhotoFn} from './image.js';
import {logger, safeHeaders} from './log.js';
import {dropPage, homePage, notFoundPage} from './page.js';
import type {RenderQueue} from './queue.js';
import type {RenderFn} from './render.js';
import type {DropRequest} from './schema.js';
import {type DropRecord, getDrop, isDropId, mediaDir, newDropId, saveDrop} from './store.js';
import {validatePaid} from './validate-paid.js';
import type {generateVoiceover as GenerateVoiceoverFn} from './voiceover.js';

export interface AppDeps {
	fetchPhoto: typeof FetchPhotoFn;
	writeCopy: typeof WriteCopyFn;
	generateVoiceover: typeof GenerateVoiceoverFn;
	// Opt-in (BACKGROUND_REMOVAL_ENABLED): undefined means skip it entirely, resolved by
	// server.ts at startup so app.ts doesn't need to know about the env var. Returns null
	// on failure — callers keep the original photo rather than failing the drop.
	removeBackground?: (photo: Buffer, mimeType: 'image/jpeg' | 'image/png') => Promise<Buffer | null>;
	pickTrack: () => MusicTrack;
	render: RenderFn;
	queue: RenderQueue;
	// Base for links handed back to callers (video_url, page_url, ...).
	publicBaseUrl: string;
	// Base the renderer's headless Chrome loads the photo from. Loopback, so a render
	// never depends on the public domain/proxy being reachable from inside the box.
	internalBaseUrl: string;
	// x402 payment middleware (src/x402.ts). Runs after validation and the busy check, so a
	// bad body or a full queue is refused before any payment is verified or settled.
	paid?: RequestHandler[];
}

export const TEMPLATES = [
	{id: 'brutal', name: 'Brutal', description: 'Black/white/red high-contrast type, hard cuts.', available: true},
	{id: 'market', name: 'Market', description: 'Loud yellow/green/red, rotated stickers, price starburst.', available: true},
] as const;

function sendError(res: express.Response, status: number, error: string, message: string, extra: object = {}) {
	// `code`, not `error`: Brimble flags any line containing "error" as ERROR, and a 404 is not one.
	logger.info('http.error_response', {req: res.locals.reqId, status, code: error, message, ...extra});
	res.status(status).json({error, message, ...extra});
}

export function createApp(deps: AppDeps) {
	const app = express();
	const base = deps.publicBaseUrl.replace(/\/+$/, '');
	const internal = deps.internalBaseUrl.replace(/\/+$/, '');
	const mediaUrl = (file: string) => `${base}/media/${encodeURIComponent(file)}`;

	app.disable('x-powered-by');
	// Coolify/Traefik terminates TLS in front of us.
	app.set('trust proxy', 1);

	// One line per request, tagged with a short id that the /drop and x402 logs reuse.
	// hasPayment is the key thing to look for when debugging PayBox: its probe arrives
	// without a payment header (expect 402), and the paid retry arrives with one.
	app.use((req, res, next) => {
		const reqId = randomBytes(4).toString('hex');
		const start = Date.now();
		res.locals.reqId = reqId;
		(req as express.Request & {reqId?: string}).reqId = reqId;
		const hasPayment = Boolean(req.get('payment-signature') || req.get('x-payment'));
		if (req.path !== '/health') {
			logger.debug('http.request_headers', {req: reqId, headers: safeHeaders(req.headers)});
		}
		res.on('close', () => {
			// /health is polled by the platform every few seconds; keep it out of info logs.
			const level = req.path === '/health' ? 'debug' : 'info';
			logger[level]('http.request', {
				req: reqId,
				method: req.method,
				path: req.originalUrl,
				status: res.statusCode,
				ms: Date.now() - start,
				hasPayment,
				contentLength: req.get('content-length') ?? null,
				ua: req.get('user-agent') ?? null,
				ip: req.ip,
				finished: res.writableFinished,
			});
		});
		next();
	});

	// PayBox's wallet/signing step likely runs in the caller's browser, and a JSON POST is a
	// non-simple request, so the browser sends a CORS preflight (OPTIONS) before the real one.
	// Express never answers OPTIONS on its own -- without this, the preflight 404s with no
	// CORS headers, the browser blocks the actual request client-side, and nothing ever
	// reaches us: no discovery probe, no payment, no render. Looks exactly like a dead widget.
	app.use((req, res, next) => {
		res.set('Access-Control-Allow-Origin', '*');
		res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.set('Access-Control-Allow-Headers', 'Content-Type, Payment-Signature, X-Payment');
		// Custom response headers are invisible to cross-origin JS unless explicitly exposed.
		res.set('Access-Control-Expose-Headers', 'Payment-Required, Payment-Response');
		if (req.method === 'OPTIONS') {
			res.status(204).end();
			return;
		}
		next();
	});

	// Spec §11: CSP restricting media (and everything else) to same-origin. page.ts's
	// <style>/<script> blocks are static (no user/LLM data interpolated into them — only
	// into escaped text/attributes), so 'unsafe-inline' here doesn't reopen an XSS hole.
	app.use((_req, res, next) => {
		res.set(
			'Content-Security-Policy',
			"default-src 'self'; media-src 'self'; img-src 'self'; script-src 'self' 'unsafe-inline'; " +
				"style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
		);
		next();
	});

	app.get('/health', (_req, res) => {
		res.json({ok: true, queue: deps.queue.stats});
	});

	app.get('/templates', (_req, res) => {
		res.json({templates: TEMPLATES});
	});

	app.get('/', (_req, res) => {
		res.type('html').send(homePage());
	});

	function dropStatusJson(drop: DropRecord) {
		const common = {id: drop.id, status: drop.status, page_url: `${base}/d/${drop.id}`, created_at: drop.createdAt, updated_at: drop.updatedAt};
		if (drop.status === 'done' && drop.video) {
			return {...common, video_url: mediaUrl(drop.video), poster_url: drop.poster ? mediaUrl(drop.poster) : null, caption: drop.copy.caption, hashtags: drop.copy.hashtags};
		}
		if (drop.status === 'failed') {
			return {...common, error: drop.error ?? 'render_failed'};
		}
		return {...common, poll_after_seconds: 5};
	}

	// Scripts/agents polling for a result get JSON by default (no Accept header, or
	// Accept: */*); only a request that actually prefers text/html gets the human page.
	app.get('/d/:id', async (req, res, next) => {
		try {
			const drop = isDropId(req.params.id) ? await getDrop(req.params.id) : null;
			const wantsHtml = req.accepts(['json', 'html']) === 'html';
			if (!drop) {
				if (wantsHtml) {
					res.status(404).type('html').send(notFoundPage());
				} else {
					res.status(404).json({error: 'not_found', message: 'No such drop.'});
				}
				return;
			}
			if (wantsHtml) {
				res.type('html').send(dropPage(drop, mediaUrl));
				return;
			}
			res.json(dropStatusJson(drop));
		} catch (err) {
			next(err);
		}
	});

	app.use(
		'/media',
		express.static(mediaDir(), {index: false, dotfiles: 'deny', fallthrough: false, immutable: true, maxAge: '7d'}),
	);

	const rejectIfBusy: RequestHandler = (_req, res, next) => {
		if (deps.queue.isFull()) {
			res.set('Retry-After', '60');
			sendError(res, 503, 'busy', 'Render queue is full, try again in a minute.');
			return;
		}
		next();
	};

	// Fast path only: validate, create the record, respond, settle. Everything slow (photo
	// fetch, AI copy, voiceover, the render itself) happens afterward in runDropJob -- see
	// src/drop-job.ts for why: PayBox's own client times out long before a 15-60s render
	// finishes, and settlement is driven entirely by how fast *this* handler responds.
	const handleDrop: RequestHandler = async (_req, res, next) => {
		const reqId = res.locals.reqId as string;
		const t0 = Date.now();
		// x402 settles any < 400 response, even one nobody is left to receive. The only
		// await left on this path is saveDrop below, but the guard still earns its keep for
		// that brief window.
		let clientGone = false;
		res.on('close', () => {
			if (!res.writableFinished) clientGone = true;
		});
		const input = res.locals.drop as DropRequest | undefined;
		if (!input) {
			// Paid but bodyless (see validate-paid.ts); a 4xx here means x402 won't settle.
			sendError(res, 400, 'invalid_request', 'Request body is required.');
			return;
		}
		const id = newDropId();
		logger.info('drop.start', {
			req: reqId,
			drop: id,
			photoHost: new URL(input.photo_url).host,
			points: input.points.length,
			language: input.language ?? 'pcg',
			template: input.template ?? 'brutal',
			queue: deps.queue.stats,
		});
		try {
			// Placeholder props/copy: real values land once runDropJob fetches the photo and
			// writes copy. dropPage()'s 'rendering' branch only reads productName/price (both
			// real, from input) before falling back to a generic "still rendering" message, so
			// these placeholders are never actually shown to anyone. `lines: input.points`
			// satisfies dropCopySchema's min(1).max(3) for free, since points already passed
			// that same bound in dropRequestSchema.
			const placeholderCopy: DropCopy = {hook: '', lines: input.points, cta: input.cta ?? '', caption: '', hashtags: []};
			const props: StatusDropProps = {
				productName: input.product_name,
				price: input.price,
				photoUrl: '',
				points: input.points,
				copy: placeholderCopy,
				handle: input.handle,
				template: input.template ?? 'brutal',
			};
			const now = new Date().toISOString();
			const record: DropRecord = {id, status: 'rendering', createdAt: now, updatedAt: now, props, copy: placeholderCopy};
			await saveDrop(record);

			if (clientGone) {
				logger.warn('drop.client_gone', {req: reqId, drop: id, ms: Date.now() - t0, note: 'client disconnected before the ack; answering 499 so x402 does not settle'});
				sendError(res, 499, 'client_closed', 'Client disconnected before the request was accepted.');
				return;
			}

			logger.info('drop.accepted', {req: reqId, drop: id, ms: Date.now() - t0});
			res.status(202).json({
				id,
				status: 'rendering',
				page_url: `${base}/d/${id}`,
				poll_after_seconds: 5,
				message: 'Vosha Studio is generating your video. GET page_url (send Accept: application/json for a machine-readable status) once status is "done" for the video, poster, caption and hashtags.',
			});

			void runDropJob(
				{
					fetchPhoto: deps.fetchPhoto,
					writeCopy: deps.writeCopy,
					generateVoiceover: deps.generateVoiceover,
					removeBackground: deps.removeBackground,
					pickTrack: deps.pickTrack,
					render: deps.render,
					queue: deps.queue,
					internalBaseUrl: internal,
				},
				id,
				input,
				reqId,
			);
		} catch (err) {
			next(err);
		}
	};

	app.post('/drop', express.json({limit: '16kb'}), validatePaid, rejectIfBusy, ...(deps.paid ?? []), handleDrop);

	app.use((_req, res) => {
		sendError(res, 404, 'not_found', 'No such route.');
	});

	const onError: ErrorRequestHandler = (err, _req, res, _next) => {
		// body-parser errors (bad JSON, too large) carry their own 4xx status.
		const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
		if (status === 500) logger.error('http.unhandled_error', {req: res.locals.reqId, error: err, stack: err?.stack});
		if (res.headersSent) return;
		if (status === 404) {
			sendError(res, 404, 'not_found', 'Not found.');
			return;
		}
		sendError(res, status, status === 500 ? 'internal_error' : 'invalid_request', status === 500 ? 'Internal error.' : err.message);
	};
	app.use(onError);

	return app;
}
