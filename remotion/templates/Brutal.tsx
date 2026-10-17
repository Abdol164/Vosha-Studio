import React from 'react';
import {AbsoluteFill, Audio, Sequence} from 'remotion';
import type {StatusDropProps} from '../types';
import {HookScene} from './scenes/HookScene';
import {ProductPointsScene} from './scenes/ProductPointsScene';
import {PriceSlamScene} from './scenes/PriceSlamScene';
import {CTAScene} from './scenes/CTAScene';

// Timeline (300 frames / 10s @ 30fps) per spec §8:
// 0-36 hook, 36-225 product+points, 225-270 price slam, 270-300 CTA.
export const Brutal: React.FC<StatusDropProps> = ({
	productName,
	price,
	photoUrl,
	points,
	copy,
	handle,
	voiceoverUrl,
}) => {
	return (
		<AbsoluteFill>
			{/* Unwrapped (not inside a limited Sequence) so it plays from frame 0 — the
			composition's own 300-frame length naturally clips it if the script ran long. */}
			{voiceoverUrl ? <Audio src={voiceoverUrl} /> : null}
			<Sequence from={0} durationInFrames={36}>
				<HookScene hook={copy.hook} />
			</Sequence>
			<Sequence from={36} durationInFrames={189}>
				<ProductPointsScene photoUrl={photoUrl} productName={productName} points={points} />
			</Sequence>
			<Sequence from={225} durationInFrames={45}>
				<PriceSlamScene price={price} />
			</Sequence>
			<Sequence from={270} durationInFrames={30}>
				<CTAScene cta={copy.cta} handle={handle} />
			</Sequence>
		</AbsoluteFill>
	);
};
