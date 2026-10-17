import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import {buildVoiceoverScript, generateVoiceover} from '../src/voiceover.js';
import {writeCopy} from '../src/copywriter.js';

const copy = await writeCopy({
	productName: "Nike Air Force 1 '07",
	price: '₦45,000',
	points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
	language: 'pcg',
});

const script = buildVoiceoverScript(copy, '₦45,000');
console.log('script:', script);
console.log('script length (chars):', script.length);

const audio = await generateVoiceover(script);
if (!audio) {
	console.log('No ELEVENLABS_API_KEY set — got null as expected fallback.');
	process.exit(0);
}

const outDir = path.resolve(import.meta.dirname, '..', 'data', 'media');
fs.mkdirSync(outDir, {recursive: true});
const outPath = path.join(outDir, 'test-voiceover.mp3');
fs.writeFileSync(outPath, audio);
console.log(`Wrote ${audio.length} bytes to data/media/test-voiceover.mp3`);
