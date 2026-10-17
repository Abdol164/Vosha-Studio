import '../src/env.js';
import path from 'node:path';
import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import type {StatusDropProps} from '../remotion/types.js';
import type {CopywriterInput} from '../src/copywriter.js';
import {writeCopy} from '../src/copywriter.js';
import {generateVoiceover} from '../src/voiceover.js';
import {pickRandomTrack} from '../src/music.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'media');
const PUBLIC_DIR = path.join(ROOT, 'public');

async function buildProps(input: {
	productName: string;
	price: string;
	points: string[];
	handle?: string;
	name: string;
	language?: CopywriterInput['language'];
	template?: StatusDropProps['template'];
}): Promise<StatusDropProps> {
	const copy = await writeCopy({
		productName: input.productName,
		price: input.price,
		points: input.points,
		language: input.language ?? 'pcg',
	});

	// MON-51: TTS voiceover — one clip per story beat, written into public/ so
	// StatusDrop.tsx's staticFile() resolution can find them, same as the sample product
	// photo. Silently skipped when ELEVENLABS_API_KEY isn't set (generateVoiceover
	// returns null) or on any other failure (quota/rate-limit/network) — same resilience
	// as the server (src/app.ts), so a flaky ElevenLabs account doesn't crash the render.
	let voiceoverClips: Record<string, string> | undefined;
	try {
		const clips = await generateVoiceover(copy, input.price);
		if (clips) {
			voiceoverClips = {};
			for (const clip of clips) {
				const fileName = `${input.name}-voiceover-${clip.key}.mp3`;
				fs.writeFileSync(path.join(PUBLIC_DIR, fileName), clip.audio);
				voiceoverClips[clip.key] = fileName;
			}
		}
	} catch (err) {
		console.warn(`"${input.name}": voiceover skipped`, err instanceof Error ? err.message : err);
	}

	const track = pickRandomTrack();

	return {
		productName: input.productName,
		price: input.price,
		photoUrl: 'sample-product.png',
		points: input.points,
		copy,
		handle: input.handle,
		template: input.template ?? 'brutal',
		voiceoverClips,
		musicUrl: track.file,
		musicStartOffsetSeconds: track.startOffsetSeconds,
	};
}

async function renderDrop(bundleLocation: string, props: StatusDropProps, name: string) {
	console.log(`\nRendering "${name}"...`);
	const start = Date.now();

	const composition = await selectComposition({
		serveUrl: bundleLocation,
		id: 'StatusDrop',
		inputProps: props,
	});

	await renderMedia({
		composition,
		serveUrl: bundleLocation,
		codec: 'h264',
		outputLocation: path.join(OUT_DIR, `${name}.mp4`),
		inputProps: props,
		crf: 24,
	});

	await renderStill({
		composition,
		serveUrl: bundleLocation,
		output: path.join(OUT_DIR, `${name}.jpg`),
		inputProps: props,
		frame: 250,
	});

	console.log(`Done "${name}" in ${Date.now() - start}ms -> data/media/${name}.mp4`);
}

async function main() {
	fs.mkdirSync(OUT_DIR, {recursive: true});

	console.log('Generating copy + voiceover...');
	const sampleProps = await buildProps({
		productName: "Nike Air Force 1 '07",
		price: '₦45,000',
		points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
		handle: '@shoebaby_minna',
		name: 'sample',
	});

	// Stress test: 60-char product name, 80-char points — must never overflow (spec Phase 1 checkpoint).
	const stressProps = await buildProps({
		productName: 'Original Authentic Nike Air Force 1 Low 07 LV8 Retro Edition Kicks',
		price: '₦45,000',
		points: [
			'One hundred percent original, brand new in box, never worn, comes with receipt',
			'Available in sizes 38 39 40 41 42 43 44 45 46, true to size, wide fit available',
			'Free same-day delivery within Minna metro and surrounding local government areas',
		],
		handle: '@shoebaby_minna',
		name: 'sample-stress',
	});

	const englishProps = await buildProps({
		productName: "Nike Air Force 1 '07",
		price: '₦45,000',
		points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
		handle: '@shoebaby_minna',
		name: 'sample-en',
		language: 'en',
	});

	// Two different products on the Market template, to visually confirm the seeded
	// randomness (sticker rotation, palette rotation, starburst shape) actually varies
	// between drops rather than looking identical.
	const marketProps1 = await buildProps({
		productName: "Nike Air Force 1 '07",
		price: '₦45,000',
		points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
		handle: '@shoebaby_minna',
		name: 'sample-market-1',
		template: 'market',
	});

	const marketProps2 = await buildProps({
		productName: 'Jollof party packs',
		price: '₦3,500',
		points: ['Feeds 2-3 people', 'Ready in 30 minutes', 'Pickup only in Minna'],
		handle: '@chopnaija',
		name: 'sample-market-2',
		template: 'market',
	});

	console.log('Bundling Remotion project...');
	const bundleLocation = await bundle({
		entryPoint: path.join(ROOT, 'remotion', 'index.ts'),
	});

	await renderDrop(bundleLocation, sampleProps, 'sample');
	await renderDrop(bundleLocation, stressProps, 'sample-stress');
	await renderDrop(bundleLocation, englishProps, 'sample-en');
	await renderDrop(bundleLocation, marketProps1, 'sample-market-1');
	await renderDrop(bundleLocation, marketProps2, 'sample-market-2');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
