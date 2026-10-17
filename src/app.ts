import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import express, {type ErrorRequestHandler, type RequestHandler} from 'express';
import type {StatusDropProps} from '../remotion/types.js';
import type {writeCopy as WriteCopyFn} from './copywriter.js';
import type {MusicTrack} from './music.js';
import {PhotoError, type fetchPhoto as FetchPhotoFn} from './image.js';
import {logger, safeHeaders} from './log.js';
import {dropPage, homePage, notFoundPage} from './page.js';
import {QueueFullError, type RenderQueue} from './queue.js';
import type {RenderFn} from './render.js';
import type {DropRequest} from './schema.js';
import {type DropRecord, getDrop, isDropId, mediaDir, newDropId, saveDrop, updateDrop} from './store.js';
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

// invalid_url is the caller's input being wrong; the rest mean the URL was fine
// syntactically but what's behind it can't be used.
function photoErrorStatus(err: PhotoError): number {
	return err.code === 'photo_invalid_url' ? 400 : 422;
}

// ElevenLabs is optional garnish: past this, the drop renders without a voiceover rather
// than holding a paid request (and the payer's authorization window) hostage.
const VOICEOVER_TIMEOUT_MS = 15_000;

function sendError(res: express.Response, status: number, error: string, message: string, extra: object = {}) {
	logger.info('http.error_response', {req: res.locals.reqId, status, error, message, ...extra});
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

	app.get('/d/:id', async (req, res, next) => {
		try {
			const drop = isDropId(req.params.id) ? await getDrop(req.params.id) : null;
			if (!drop) {
				res.status(404).type('html').send(notFoundPage());
				return;
			}
			res.type('html').send(dropPage(drop, mediaUrl));
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

	const handleDrop: RequestHandler = async (_req, res, next) => {
		const reqId = res.locals.reqId as string;
		const t0 = Date.now();
		const since = () => Date.now() - t0;
		// x402 settles any < 400 response, even one nobody is left to receive. If the
		// caller gives up mid-render we must answer >= 400 so they aren't charged for it.
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
			let photo;
			try {
				photo = await deps.fetchPhoto(input.photo_url);
				logger.info('drop.photo', {req: reqId, drop: id, ms: since(), format: photo.format, width: photo.width, height: photo.height, bytes: photo.data.length});
			} catch (err) {
				if (err instanceof PhotoError) {
					sendError(res, photoErrorStatus(err), err.code, err.message);
					return;
				}
				throw err;
			}
			if (deps.removeBackground) {
				const cutout = await deps.removeBackground(photo.data, photo.format === 'png' ? 'image/png' : 'image/jpeg');
				logger.info('drop.background_removal', {req: reqId, drop: id, ms: since(), ok: Boolean(cutout)});
				if (cutout) {
					photo = {...photo, data: cutout, format: 'png'};
				}
			}
			const photoFile = `${id}-photo.${photo.format === 'png' ? 'png' : 'jpg'}`;
			await fs.writeFile(path.join(mediaDir(), photoFile), photo.data);

			const copy = await deps.writeCopy({
				productName: input.product_name,
				price: input.price,
				points: input.points,
				language: input.language,
				cta: input.cta,
			});
			logger.info('drop.copy', {req: reqId, drop: id, ms: since(), hook: copy.hook, lines: copy.lines.length});
			// Voiceover failures never fail the drop (same idea as the copywriter fallback).
			// One clip per story beat (hook/point/price/cta) rather than one long clip from
			// frame 0, so narration lands when its beat actually appears on screen — see
			// VoiceoverTrack in Brutal.tsx/Market.tsx.
			let voiceoverClips: Record<string, string> | undefined;
			try {
				const clips = await Promise.race([
					deps.generateVoiceover(copy, input.price),
					new Promise<null>((_, reject) =>
						setTimeout(() => reject(new Error('voiceover timed out')), VOICEOVER_TIMEOUT_MS).unref(),
					),
				]);
				if (clips) {
					voiceoverClips = {};
					for (const clip of clips) {
						const voiceFile = `${id}-voiceover-${clip.key}.mp3`;
						await fs.writeFile(path.join(mediaDir(), voiceFile), clip.audio);
						voiceoverClips[clip.key] = `${internal}/media/${voiceFile}`;
					}
				}
				logger.info('drop.voiceover', {req: reqId, drop: id, ms: since(), clips: voiceoverClips ? Object.keys(voiceoverClips) : []});
			} catch (err) {
				logger.warn('drop.voiceover_skipped', {req: reqId, drop: id, ms: since(), error: err});
			}
			const track = deps.pickTrack();

			const props: StatusDropProps = {
				productName: input.product_name,
				price: input.price,
				photoUrl: `${internal}/media/${photoFile}`,
				points: input.points,
				copy,
				handle: input.handle,
				template: input.template ?? 'brutal',
				voiceoverClips,
				// A public/ path, resolved by staticFile() inside the bundle.
				musicUrl: track.file,
				musicStartOffsetSeconds: track.startOffsetSeconds,
			};
			const now = new Date().toISOString();
			const record: DropRecord = {id, status: 'rendering', createdAt: now, updatedAt: now, props, copy};
			await saveDrop(record);

			let result;
			logger.info('drop.render_queued', {req: reqId, drop: id, ms: since(), queue: deps.queue.stats});
			try {
				result = await deps.queue.run(() => {
					logger.info('drop.render_start', {req: reqId, drop: id, ms: since()});
					return deps.render(id, props);
				});
				logger.info('drop.render_done', {req: reqId, drop: id, ms: since()});
			} catch (err) {
				const busy = err instanceof QueueFullError;
				await updateDrop(id, {status: 'failed', error: busy ? 'queue_full' : String(err)});
				if (busy) {
					res.set('Retry-After', '60');
					sendError(res, 503, 'busy', 'Render queue is full, try again in a minute.');
				} else {
					logger.error('drop.render_failed', {req: reqId, drop: id, ms: since(), error: err});
					sendError(res, 500, 'render_failed', 'Video render failed.');
				}
				return;
			}

			await updateDrop(id, {status: 'done', video: result.video, poster: result.poster});
			if (clientGone) {
				logger.warn('drop.client_gone', {req: reqId, drop: id, ms: since(), note: 'rendered after the client disconnected; answering 499 so x402 does not settle'});
				sendError(res, 499, 'client_closed', 'Client disconnected before the render finished.');
				return;
			}
			logger.info('drop.done', {req: reqId, drop: id, ms: since()});
			res.json({
				id,
				video_url: mediaUrl(result.video),
				poster_url: mediaUrl(result.poster),
				page_url: `${base}/d/${id}`,
				caption: copy.caption,
				hashtags: copy.hashtags,
			});
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
