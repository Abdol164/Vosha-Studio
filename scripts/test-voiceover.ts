import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import {buildVoiceoverSegments, generateVoiceover} from '../src/voiceover.js';
import {writeCopy} from '../src/copywriter.js';

const copy = await writeCopy({
	productName: "Nike Air Force 1 '07",
	price: '₦45,000',
	points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
	language: 'pcg',
});

const segments = buildVoiceoverSegments(copy, '₦45,000');
console.log('segments:', segments);

const clips = await generateVoiceover(copy, '₦45,000');
if (!clips) {
	console.log('No ELEVENLABS_API_KEY set — got null as expected fallback.');
	process.exit(0);
}

const outDir = path.resolve(import.meta.dirname, '..', 'data', 'media');
fs.mkdirSync(outDir, {recursive: true});
for (const clip of clips) {
	const outPath = path.join(outDir, `test-voiceover-${clip.key}.mp3`);
	fs.writeFileSync(outPath, clip.audio);
	console.log(`Wrote ${clip.audio.length} bytes to data/media/test-voiceover-${clip.key}.mp3`);
}
