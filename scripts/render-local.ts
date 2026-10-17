import path from 'node:path';
import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import type {StatusDropProps} from '../remotion/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'media');

const sampleProps: StatusDropProps = {
	productName: "Nike Air Force 1 '07",
	price: '₦45,000',
	photoUrl: 'sample-product.png',
	points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
	copy: {
		hook: 'NEW DROP',
		lines: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
		cta: 'DM to order',
		caption: 'Original AF1 don land! Sizes 40-45, free delivery for Minna. DM now.',
		hashtags: ['#AF1', '#NaijaKicks', '#MinnaSellers'],
	},
	handle: '@shoebaby_minna',
	template: 'brutal',
};

// Stress test: 60-char product name, 80-char points — must never overflow (spec Phase 1 checkpoint).
const stressProps: StatusDropProps = {
	...sampleProps,
	productName: 'Original Authentic Nike Air Force 1 Low 07 LV8 Retro Edition Kicks',
	points: [
		'One hundred percent original, brand new in box, never worn, comes with receipt',
		'Available in sizes 38 39 40 41 42 43 44 45 46, true to size, wide fit available',
		'Free same-day delivery within Minna metro and surrounding local government areas',
	],
	copy: {
		...sampleProps.copy,
		lines: [
			'One hundred percent original, brand new in box, never worn, comes with receipt',
			'Available in sizes 38 39 40 41 42 43 44 45 46, true to size, wide fit available',
			'Free same-day delivery within Minna metro and surrounding local government areas',
		],
	},
};

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

	console.log('Bundling Remotion project...');
	const bundleLocation = await bundle({
		entryPoint: path.join(ROOT, 'remotion', 'index.ts'),
	});

	await renderDrop(bundleLocation, sampleProps, 'sample');
	await renderDrop(bundleLocation, stressProps, 'sample-stress');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
