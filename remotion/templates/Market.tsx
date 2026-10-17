import React from 'react';
import {AbsoluteFill, Audio, Sequence, useVideoConfig} from 'remotion';
import type {StatusDropProps} from '../types';
import {MarketCTAScene} from './market/MarketCTAScene';
import {MarketHookScene} from './market/MarketHookScene';
import {MarketPriceBurstScene} from './market/MarketPriceBurstScene';
import {MarketProductPointsScene} from './market/MarketProductPointsScene';

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
	voiceoverUrl,
	musicUrl,
	musicStartOffsetSeconds,
}) => {
	const {fps} = useVideoConfig();
	// No per-drop id is threaded this deep, so the seed is derived from content that's
	// already unique per drop (name/price/hook) — stable within a render, varies across
	// drops. random() is deterministic per seed, so this never flickers across frames.
	const seed = `${productName}|${price}|${copy.hook}`;

	return (
		<AbsoluteFill>
			{voiceoverUrl ? <Audio src={voiceoverUrl} /> : null}
			{musicUrl ? (
				<Audio
					src={musicUrl}
					volume={0.25}
					trimBefore={Math.round((musicStartOffsetSeconds ?? 0) * fps)}
				/>
			) : null}
			<Sequence from={0} durationInFrames={36}>
				<MarketHookScene hook={copy.hook} seed={seed} />
			</Sequence>
			<Sequence from={36} durationInFrames={189}>
				<MarketProductPointsScene photoUrl={photoUrl} productName={productName} points={points} seed={seed} />
			</Sequence>
			<Sequence from={225} durationInFrames={45}>
				<MarketPriceBurstScene price={price} seed={seed} />
			</Sequence>
			<Sequence from={270} durationInFrames={30}>
				<MarketCTAScene cta={copy.cta} handle={handle} seed={seed} />
			</Sequence>
		</AbsoluteFill>
	);
};
