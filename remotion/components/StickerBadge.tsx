import React from 'react';
import {interpolate, random} from 'remotion';
import {jetBrainsMonoFontFamily} from '../fonts';
import {AutoFitText} from './AutoFitText';
import {useBouncyPop, useWobble} from './motion';
import {MARKET_COLORS} from '../templates/market/palette';

interface StickerBadgeProps {
	text: string;
	color: string;
	textColor?: string;
	// Unique per element (not per frame) — drives rotation/wobble phase, stable across
	// a render but different from drop to drop since callers seed it from drop content.
	seed: string;
	delay?: number;
	// Fixed-size mode for short, controlled labels (e.g. "NEW DROP!").
	fontSize?: number;
	// Auto-fit mode for arbitrary-length caller text (points can run up to 80 chars per
	// spec) — shrinks to fit rather than overflowing the sticker.
	maxWidth?: number;
	maxFontSize?: number;
	maxRotateDeg?: number;
	style?: React.CSSProperties;
}

export const StickerBadge: React.FC<StickerBadgeProps> = ({
	text,
	color,
	textColor = MARKET_COLORS.ink,
	seed,
	delay = 0,
	fontSize = 28,
	maxWidth,
	maxFontSize = 30,
	maxRotateDeg = 9,
	style,
}) => {
	const pop = useBouncyPop(delay);
	const scale = Math.max(0, interpolate(pop, [0, 1], [0, 1], {extrapolateRight: 'clamp'}));
	const baseRotate = (random(`${seed}-rotate`) * 2 - 1) * maxRotateDeg;
	const wobble = useWobble(2, 40 + random(`${seed}-period`) * 20, random(`${seed}-phase`) * Math.PI * 2);

	return (
		<div
			style={{
				display: 'inline-block',
				width: 'fit-content',
				maxWidth,
				backgroundColor: color,
				color: textColor,
				border: `4px solid ${MARKET_COLORS.ink}`,
				padding: '8px 16px',
				transform: `scale(${scale}) rotate(${baseRotate + wobble}deg)`,
				...style,
			}}
		>
			{maxWidth ? (
				<AutoFitText
					text={text}
					maxWidth={maxWidth - 40}
					maxFontSize={maxFontSize}
					fontFamily={jetBrainsMonoFontFamily}
					fontWeight={700}
					color={textColor}
					textTransform="uppercase"
				/>
			) : (
				<div
					style={{
						fontFamily: jetBrainsMonoFontFamily,
						fontWeight: 700,
						fontSize,
						textTransform: 'uppercase',
						whiteSpace: 'nowrap',
					}}
				>
					{text}
				</div>
			)}
		</div>
	);
};
