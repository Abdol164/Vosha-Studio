import React from 'react';
import {random} from 'remotion';

function starburstClipPath(spikes: number, innerRatio: number): string {
	const points: string[] = [];
	const total = spikes * 2;
	for (let i = 0; i < total; i++) {
		const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
		const r = i % 2 === 0 ? 50 : 50 * innerRatio;
		const x = 50 + r * Math.cos(angle);
		const y = 50 + r * Math.sin(angle);
		points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
	}
	return `polygon(${points.join(', ')})`;
}

interface StarburstProps {
	size: number;
	color: string;
	seed: string;
	spikes?: number;
	rotateDeg?: number;
	style?: React.CSSProperties;
}

// A radiating spike shape (CSS clip-path, no image assets) behind the price — spike
// count and inner/outer ratio are seeded so the burst's exact shape varies per drop.
export const Starburst: React.FC<StarburstProps> = ({size, color, seed, spikes = 14, rotateDeg = 0, style}) => {
	const innerRatio = 0.5 + random(`${seed}-starburst-inner`) * 0.15;
	return (
		<div
			style={{
				position: 'absolute',
				width: size,
				height: size,
				backgroundColor: color,
				clipPath: starburstClipPath(spikes, innerRatio),
				transform: `rotate(${rotateDeg}deg)`,
				...style,
			}}
		/>
	);
};
