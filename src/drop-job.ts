import fs from 'node:fs/promises';
import path from 'node:path';
import type {StatusDropProps} from '../remotion/types.js';
import type {writeCopy as WriteCopyFn} from './copywriter.js';
import {PhotoError, type fetchPhoto as FetchPhotoFn} from './image.js';
import {logger} from './log.js';
import type {MusicTrack} from './music.js';
import {QueueFullError, type RenderQueue} from './queue.js';
import type {RenderFn} from './render.js';
import type {DropRequest} from './schema.js';
import {mediaDir, updateDrop} from './store.js';
import type {generateVoiceover as GenerateVoiceoverFn} from './voiceover.js';

export interface DropJobDeps {
	fetchPhoto: typeof FetchPhotoFn;
	writeCopy: typeof WriteCopyFn;
	generateVoiceover: typeof GenerateVoiceoverFn;
	// Opt-in (BACKGROUND_REMOVAL_ENABLED): undefined means skip it entirely, resolved by
	// server.ts at startup. Returns null on failure — callers keep the original photo.
	removeBackground?: (photo: Buffer, mimeType: 'image/jpeg' | 'image/png') => Promise<Buffer | null>;
	pickTrack: () => MusicTrack;
	render: RenderFn;
	queue: RenderQueue;
	// Base the renderer's headless Chrome loads the photo from. Loopback, so a render
	// never depends on the public domain/proxy being reachable from inside the box.
	internalBaseUrl: string;
}

// ElevenLabs is optional garnish: past this, the drop renders without a voiceover rather
// than holding up the job (no payer authorization window to protect anymore, but a stuck
// ElevenLabs call would still tie up a render-queue-adjacent slot indefinitely).
const VOICEOVER_TIMEOUT_MS = 15_000;

// Everything POST /drop used to do between verifying payment and responding, now running
// after the fast 202 ack (see handleDrop in app.ts). Payment has already settled by the
// time this runs, so every failure path here updates the DropRecord instead of the HTTP
// response — there's no response left to send. The id's DropRecord already exists
// (status: 'rendering', written by handleDrop before it responded).
export async function runDropJob(deps: DropJobDeps, id: string, input: DropRequest, reqId: string): Promise<void> {
	const t0 = Date.now();
	const since = () => Date.now() - t0;
	const internal = deps.internalBaseUrl.replace(/\/+$/, '');
	try {
		let photo;
		try {
			photo = await deps.fetchPhoto(input.photo_url);
			logger.info('drop.photo', {req: reqId, drop: id, ms: since(), format: photo.format, width: photo.width, height: photo.height, bytes: photo.data.length});
		} catch (err) {
			const code = err instanceof PhotoError ? err.code : 'photo_fetch_failed';
			logger.warn('drop.photo_failed', {req: reqId, drop: id, ms: since(), error: err});
			await updateDrop(id, {status: 'failed', error: code});
			return;
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
		await updateDrop(id, {props, copy});

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
			logger.error('drop.render_failed', {req: reqId, drop: id, ms: since(), error: err, busy});
			await updateDrop(id, {status: 'failed', error: busy ? 'queue_full' : 'render_failed'});
			return;
		}

		await updateDrop(id, {status: 'done', video: result.video, poster: result.poster});
		logger.info('drop.done', {req: reqId, drop: id, ms: since()});
	} catch (err) {
		// Defense in depth: nothing above should throw uncaught, but this stops the record
		// getting stuck in 'rendering' forever if it does.
		logger.error('drop.job_unhandled_error', {req: reqId, drop: id, ms: since(), error: err});
		await updateDrop(id, {status: 'failed', error: 'internal_error'}).catch(() => {});
	}
}
