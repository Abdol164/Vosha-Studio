import {ElevenLabsClient} from '@elevenlabs/elevenlabs-js';
import type {DropCopy} from '../remotion/types.js';

// "Sarah" — free-tier ElevenLabs premade voice. "Tolani" (Nigerian accent, better fit
// for pcg copy) needs a paid plan/credits for library voices; switch ELEVENLABS_VOICE_ID
// to JMwQvjJt08OhYlPBWeyc if that's ever funded.
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const MODEL_ID = 'eleven_multilingual_v2'; // best accent/language coverage for pcg/yo

// Root cause of a real production incident (2026-10-17 ~22:17-22:23 UTC): the SDK
// retries each failing request twice by default. With up to 6 parallel segment calls,
// one bad account state (free-tier lockout/rate-limit) meant up to 18 real HTTP
// attempts per drop — slow enough that PayBox's client gave up and re-probed (a fresh
// 402) while the original request kept running server-side and settled anyway. Both
// fixes below are deliberate, not incidental: no retries (401/429 aren't transient, and
// we already have a drop-level fallback to no audio) and a short per-call timeout so a
// single slow call can't eat the request's time budget.
const REQUEST_OPTIONS = {maxRetries: 0, timeoutInSeconds: 5};

// Circuit breaker: once a call fails, stop calling ElevenLabs entirely for a cooldown
// window instead of retrying on every subsequent drop. We're on the free tier; hitting
// an already-flagged/limited account repeatedly is how the incident above happened in
// the first place, and this stops that pattern outright rather than just softening it.
const COOLDOWN_MS = 5 * 60 * 1000;
let circuitOpenUntil = 0;

export function voiceoverCircuitIsOpen(): boolean {
	return Date.now() < circuitOpenUntil;
}

export interface VoiceoverClip {
	// "hook" | "point-0".."point-2" | "price" | "cta" — matches remotion/templates/
	// timeline.ts's beats, consumed by VoiceoverTrack in Brutal.tsx/Market.tsx.
	key: string;
	audio: Buffer;
}

// One short phrase per story beat, not one long script read from frame 0 — the video
// doesn't *show* the price until ~7.5s and the CTA until ~9s, so a single clip reading
// hook→point→price→cta back to back finished narrating long before the visuals caught
// up. Each clip instead gets placed at its own beat's reveal frame (see the composers).
export function buildVoiceoverSegments(copy: DropCopy, price: string): Array<{key: string; text: string}> {
	return [
		{key: 'hook', text: copy.hook},
		...copy.lines.map((text, i) => ({key: `point-${i}`, text})),
		{key: 'price', text: price},
		{key: 'cta', text: copy.cta},
	].filter((segment) => segment.text.trim().length > 0);
}

// Returns one MP3 Buffer per story beat, or null if ELEVENLABS_API_KEY isn't set, the
// circuit is open, or generation fails — callers render without audio in that case
// rather than failing the whole drop, same fallback pattern as copywriter.ts. Segments
// are generated in parallel so the total wait is close to the slowest single short
// phrase, not their sum, and each is capped at REQUEST_OPTIONS.timeoutInSeconds with no
// retries.
export async function generateVoiceover(copy: DropCopy, price: string): Promise<VoiceoverClip[] | null> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey || voiceoverCircuitIsOpen()) {
		return null;
	}
	const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
	const client = new ElevenLabsClient({apiKey});
	const segments = buildVoiceoverSegments(copy, price);

	try {
		const clips = await Promise.all(
			segments.map(async ({key, text}) => {
				const audio = await client.textToSpeech.convert(
					voiceId,
					{text, modelId: MODEL_ID, outputFormat: 'mp3_44100_128'},
					REQUEST_OPTIONS,
				);
				const chunks: Uint8Array[] = [];
				for await (const chunk of audio) {
					chunks.push(chunk);
				}
				return {key, audio: Buffer.concat(chunks)};
			}),
		);
		return clips;
	} catch (err) {
		circuitOpenUntil = Date.now() + COOLDOWN_MS;
		throw err;
	}
}
