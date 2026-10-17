import React from 'react';
import {AbsoluteFill, Audio, Sequence, useVideoConfig} from 'remotion';
import type {StatusDropProps} from '../types';
import {VoiceoverTrack} from '../components/VoiceoverTrack';
import {HookScene} from './scenes/HookScene';
import {ProductPointsScene} from './scenes/ProductPointsScene';
import {PriceSlamScene} from './scenes/PriceSlamScene';
import {CTAScene} from './scenes/CTAScene';
import {CTA_FRAMES, HOOK_FRAMES, POINT_SLOT, PRICE_FRAMES, PRODUCT_POINTS_FRAMES, REVEAL_FRAMES} from './timeline';

// Timeline (300 frames / 10s @ 30fps) per spec §8:
// 0-36 hook, 36-225 product+points, 225-270 price slam, 270-300 CTA.
export const Brutal: React.FC<StatusDropProps> = ({
	productName,
	price,
	photoUrl,
	points,
	copy,
	handle,
	voiceoverClips,
	musicUrl,
	musicStartOffsetSeconds,
}) => {
	const {fps} = useVideoConfig();
	const pointsStart = HOOK_FRAMES + REVEAL_FRAMES;
	const priceStart = HOOK_FRAMES + PRODUCT_POINTS_FRAMES;
	const ctaStart = priceStart + PRICE_FRAMES;

	return (
		<AbsoluteFill>
			{/* Music unwrapped (not inside a limited Sequence) so it plays from frame 0 — the
			composition's own 300-frame length clips it if it runs long. Voiceover clips are
			each wrapped in their own Sequence (VoiceoverTrack) at the GLOBAL frame matching
			their beat's visual reveal, so narration lands when that beat appears on screen. */}
			{musicUrl ? (
				<Audio
					src={musicUrl}
					volume={0.25}
					trimBefore={Math.round((musicStartOffsetSeconds ?? 0) * fps)}
				/>
			) : null}
			{voiceoverClips ? (
				<>
					<VoiceoverTrack clips={voiceoverClips} segmentKey="hook" from={0} durationInFrames={HOOK_FRAMES} />
					{points.map((_, i) => (
						<VoiceoverTrack
							key={i}
							clips={voiceoverClips}
							segmentKey={`point-${i}`}
							from={pointsStart + i * POINT_SLOT}
							durationInFrames={POINT_SLOT}
						/>
					))}
					<VoiceoverTrack clips={voiceoverClips} segmentKey="price" from={priceStart} durationInFrames={PRICE_FRAMES} />
					<VoiceoverTrack clips={voiceoverClips} segmentKey="cta" from={ctaStart} durationInFrames={CTA_FRAMES} />
				</>
			) : null}
			<Sequence from={0} durationInFrames={HOOK_FRAMES}>
				<HookScene hook={copy.hook} />
			</Sequence>
			<Sequence from={HOOK_FRAMES} durationInFrames={PRODUCT_POINTS_FRAMES}>
				<ProductPointsScene photoUrl={photoUrl} productName={productName} points={points} />
			</Sequence>
			<Sequence from={priceStart} durationInFrames={PRICE_FRAMES}>
				<PriceSlamScene price={price} />
			</Sequence>
			<Sequence from={ctaStart} durationInFrames={CTA_FRAMES}>
				<CTAScene cta={copy.cta} handle={handle} />
			</Sequence>
		</AbsoluteFill>
	);
};
