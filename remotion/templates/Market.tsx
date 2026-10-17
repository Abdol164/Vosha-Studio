import React from 'react';
import {AbsoluteFill, Audio, Sequence, useVideoConfig} from 'remotion';
import type {StatusDropProps} from '../types';
import {VoiceoverTrack} from '../components/VoiceoverTrack';
import {MarketCTAScene} from './market/MarketCTAScene';
import {MarketHookScene} from './market/MarketHookScene';
import {MarketPriceBurstScene} from './market/MarketPriceBurstScene';
import {MarketProductPointsScene} from './market/MarketProductPointsScene';
import {CTA_FRAMES, HOOK_FRAMES, POINT_SLOT, PRICE_FRAMES, PRODUCT_POINTS_FRAMES, REVEAL_FRAMES} from './timeline';

// Same 300-frame beat as Brutal (0-36 hook, 36-225 product+points, 225-270 price,
// 270-300 CTA) so both templates stay in sync with the music/voiceover timing — only
// the visual/motion language differs (bouncy/elastic vs. heavy/mechanical).
export const Market: React.FC<StatusDropProps> = ({
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
	// No per-drop id is threaded this deep, so the seed is derived from content that's
	// already unique per drop (name/price/hook) — stable within a render, varies across
	// drops. random() is deterministic per seed, so this never flickers across frames.
	const seed = `${productName}|${price}|${copy.hook}`;
	const pointsStart = HOOK_FRAMES + REVEAL_FRAMES;
	const priceStart = HOOK_FRAMES + PRODUCT_POINTS_FRAMES;
	const ctaStart = priceStart + PRICE_FRAMES;

	return (
		<AbsoluteFill>
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
				<MarketHookScene hook={copy.hook} seed={seed} />
			</Sequence>
			<Sequence from={HOOK_FRAMES} durationInFrames={PRODUCT_POINTS_FRAMES}>
				<MarketProductPointsScene photoUrl={photoUrl} productName={productName} points={points} seed={seed} />
			</Sequence>
			<Sequence from={priceStart} durationInFrames={PRICE_FRAMES}>
				<MarketPriceBurstScene price={price} seed={seed} />
			</Sequence>
			<Sequence from={ctaStart} durationInFrames={CTA_FRAMES}>
				<MarketCTAScene cta={copy.cta} handle={handle} seed={seed} />
			</Sequence>
		</AbsoluteFill>
	);
};
