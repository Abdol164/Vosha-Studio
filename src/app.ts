import fs from 'node:fs/promises';
import path from 'node:path';
import express, {type ErrorRequestHandler, type RequestHandler} from 'express';
import type {StatusDropProps} from '../remotion/types.js';
import type {writeCopy as WriteCopyFn} from './copywriter.js';
import {PhotoError, type fetchPhoto as FetchPhotoFn} from './image.js';
import {dropPage, homePage, notFoundPage} from './page.js';
import {QueueFullError, type RenderQueue} from './queue.js';
import type {RenderFn} from './render.js';
import type {DropRequest} from './schema.js';
import {type DropRecord, getDrop, isDropId, mediaDir, newDropId, saveDrop, updateDrop} from './store.js';
import {validatePaid} from './validate-paid.js';

export interface AppDeps {
	fetchPhoto: typeof FetchPhotoFn;
	writeCopy: typeof WriteCopyFn;
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
	{id: 'market', name: 'Market', description: 'Not built yet — renders as brutal.', available: false},
] as const;

// invalid_url is the caller's input being wrong; the rest mean the URL was fine
// syntactically but what's behind it can't be used.
function photoErrorStatus(err: PhotoError): number {
	return err.code === 'photo_invalid_url' ? 400 : 422;
}

function sendError(res: express.Response, status: number, error: string, message: string, extra: object = {}) {
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
		try {
			let photo;
			try {
				photo = await deps.fetchPhoto(input.photo_url);
			} catch (err) {
				if (err instanceof PhotoError) {
					sendError(res, photoErrorStatus(err), err.code, err.message);
					return;
				}
				throw err;
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
			const props: StatusDropProps = {
				productName: input.product_name,
				price: input.price,
				photoUrl: `${internal}/media/${photoFile}`,
				points: input.points,
				copy,
				handle: input.handle,
				template: input.template ?? 'brutal',
			};
			const now = new Date().toISOString();
			const record: DropRecord = {id, status: 'rendering', createdAt: now, updatedAt: now, props, copy};
			await saveDrop(record);

			let result;
			try {
				result = await deps.queue.run(() => deps.render(id, props));
			} catch (err) {
				const busy = err instanceof QueueFullError;
				await updateDrop(id, {status: 'failed', error: busy ? 'queue_full' : String(err)});
				if (busy) {
					res.set('Retry-After', '60');
					sendError(res, 503, 'busy', 'Render queue is full, try again in a minute.');
				} else {
					console.error(`render ${id} failed`, err);
					sendError(res, 500, 'render_failed', 'Video render failed.');
				}
				return;
			}

			await updateDrop(id, {status: 'done', video: result.video, poster: result.poster});
			if (clientGone) {
				console.warn(`drop ${id} rendered after the client disconnected; not settling`);
				sendError(res, 499, 'client_closed', 'Client disconnected before the render finished.');
				return;
			}
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
		if (status === 500) console.error(err);
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
