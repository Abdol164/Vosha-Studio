import React from 'react';
import {interpolate, random, useCurrentFrame} from 'remotion';

interface ConfettiProps {
	count: number;
	colors: readonly string[];
	seed: string;
	startFrame: number;
	areaWidth: number;
	areaHeight: number;
}

// Scattered square particles that pop in with a staggered delay — positions, colors,
// sizes and timing are all seeded so the scatter pattern differs per drop but never
// flickers frame to frame within one render.
export const Confetti: React.FC<ConfettiProps> = ({count, colors, seed, startFrame, areaWidth, areaHeight}) => {
	const frame = useCurrentFrame();

	return (
		<>
			{Array.from({length: count}, (_, i) => {
				const px = random(`${seed}-x-${i}`) * areaWidth;
				const py = random(`${seed}-y-${i}`) * areaHeight;
				const color = colors[Math.floor(random(`${seed}-c-${i}`) * colors.length)]!;
				const delay = random(`${seed}-d-${i}`) * 12;
				const sz = 10 + random(`${seed}-s-${i}`) * 14;
				const rotate = random(`${seed}-r-${i}`) * 360;
				const progress = interpolate(frame, [startFrame + delay, startFrame + delay + 10], [0, 1], {
					extrapolateLeft: 'clamp',
					extrapolateRight: 'clamp',
				});
				if (progress <= 0) return null;
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: px,
							top: py,
							width: sz,
							height: sz,
							backgroundColor: color,
							opacity: progress,
							transform: `scale(${progress}) rotate(${rotate}deg)`,
						}}
					/>
				);
			})}
		</>
	);
};
