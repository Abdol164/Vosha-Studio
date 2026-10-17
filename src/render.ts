import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import type {StatusDropProps} from '../remotion/types.js';
import {mediaDir} from './store.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const POSTER_FRAME = 250;

export interface RenderResult {
	// File names inside mediaDir().
	video: string;
	poster: string;
}

export function renderConcurrency(raw = process.env.RENDER_CONCURRENCY): number {
	const n = Number.parseInt(raw ?? '', 10);
	return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 2;
}

export type RenderFn = (id: string, props: StatusDropProps) => Promise<RenderResult>;

// Bundling takes seconds, so it happens once and every render reuses it. The Docker image
// prebuilds it (REMOTION_BUNDLE_DIR) because webpack peaks around 650 MB, which OOM-killed
// a 512 MB Brimble instance at boot.
export async function createRenderer(): Promise<RenderFn> {
	// Otherwise Remotion downloads Chrome lazily on the first render, and a failed download
	// there escapes as an uncaught rejection that kills the process mid-request.
	await ensureBrowser();
	const prebuilt = process.env.REMOTION_BUNDLE_DIR;
	const serveUrl =
		prebuilt && existsSync(path.join(prebuilt, 'index.html'))
			? prebuilt
			: await bundle({entryPoint: path.join(ROOT, 'remotion', 'index.ts')});

	return async (id, props) => {
		const video = `${id}.mp4`;
		const poster = `${id}.jpg`;
		const videoPath = path.join(mediaDir(), video);
		const posterPath = path.join(mediaDir(), poster);
		try {
			const composition = await selectComposition({serveUrl, id: 'StatusDrop', inputProps: props});
			await renderMedia({
				composition,
				serveUrl,
				codec: 'h264',
				outputLocation: videoPath,
				inputProps: props,
				crf: 24,
				// Remotion defaults to half the CPUs it sees, and in a container that's the
				// host's core count, so a big host could open many Chrome tabs at once and
				// OOM a 1-2 GB instance mid-render.
				concurrency: renderConcurrency(),
			});
			await renderStill({composition, serveUrl, output: posterPath, inputProps: props, frame: POSTER_FRAME});
		} catch (err) {
			// Don't leave a half-written mp4 where /media would serve it.
			await Promise.all([fs.rm(videoPath, {force: true}), fs.rm(posterPath, {force: true})]);
			throw err;
		}
		return {video, poster};
	};
}
