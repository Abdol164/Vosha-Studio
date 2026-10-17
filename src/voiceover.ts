import {ElevenLabsClient} from '@elevenlabs/elevenlabs-js';
import type {DropCopy} from '../remotion/types.js';

// "Sarah" — free-tier ElevenLabs premade voice. "Tolani" (Nigerian accent, better fit
// for pcg copy) needs a paid plan/credits for library voices; switch ELEVENLABS_VOICE_ID
// to JMwQvjJt08OhYlPBWeyc if that's ever funded.
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const MODEL_ID = 'eleven_multilingual_v2'; // best accent/language coverage for pcg/yo

// Short on purpose: the video is a fixed 10s, so the voiceover is clipped to fit it
// (see Brutal.tsx's <Audio endAt>) — reading all 3 points aloud would run long and get
// cut off mid-sentence. Hook + top point + price + cta covers the beats in ~8s.
export function buildVoiceoverScript(copy: DropCopy, price: string): string {
	const topLine = copy.lines[0];
	const parts = [copy.hook, topLine, price, copy.cta].filter((part): part is string => Boolean(part));
	return parts.join('. ') + '.';
}

// Returns an MP3 Buffer, or null if ELEVENLABS_API_KEY isn't set — callers render
// without audio in that case rather than failing the whole drop, same fallback pattern
// as copywriter.ts.
export async function generateVoiceover(script: string): Promise<Buffer | null> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		return null;
	}
	const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
	const client = new ElevenLabsClient({apiKey});

	const audio = await client.textToSpeech.convert(voiceId, {
		text: script,
		modelId: MODEL_ID,
		outputFormat: 'mp3_44100_128',
	});

	const chunks: Uint8Array[] = [];
	for await (const chunk of audio) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
