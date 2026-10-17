import React from 'react';
import {AbsoluteFill, Img, interpolate, random, useCurrentFrame, useVideoConfig} from 'remotion';
import {interFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {StickerBadge} from '../../components/StickerBadge';
import {useBouncyPop} from '../../components/motion';
import {MARKET_COLORS, pickMarketPalette} from './palette';
import {POINT_SLOT, REVEAL_FRAMES} from '../timeline';

export const MarketProductPointsScene: React.FC<{
	photoUrl: string;
	productName: string;
	points: string[];
	seed: string;
}> = ({photoUrl, productName, points, seed}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();
	const photoPop = useBouncyPop(0);
	const photoScale = Math.max(0, interpolate(photoPop, [0, 1], [0.5, 1], {extrapolateRight: 'clamp'}));
	const photoTilt = (random(`${seed}-photo-tilt`) * 2 - 1) * 3;
	const palette = pickMarketPalette(seed);

	const photoHeightPx = interpolate(
		frame,
		[REVEAL_FRAMES - 20, REVEAL_FRAMES],
		[height * 0.58, height * 0.32],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	const photoTop = 90;
	const nameBarTop = photoTop + photoHeightPx + 24;
	const pointsTop = nameBarTop + 96;
	const contentWidth = width - 140;

	return (
		<AbsoluteFill style={{backgroundColor: MARKET_COLORS.white}}>
			<div
				style={{
					position: 'absolute',
					top: photoTop,
					left: '50%',
					transform: `translateX(-50%) scale(${photoScale}) rotate(${photoTilt}deg)`,
					width: contentWidth,
					height: photoHeightPx,
					border: `8px solid ${MARKET_COLORS.ink}`,
					backgroundColor: MARKET_COLORS.white,
					overflow: 'hidden',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<Img src={photoUrl} style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} />
			</div>

			<div
				style={{
					position: 'absolute',
					top: nameBarTop,
					left: 70,
					right: 70,
					backgroundColor: MARKET_COLORS.ink,
					padding: '14px 20px',
					textAlign: 'center',
				}}
			>
				<AutoFitText
					text={productName}
					maxWidth={contentWidth - 40}
					maxFontSize={46}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={MARKET_COLORS.white}
					style={{margin: '0 auto'}}
				/>
			</div>

			<div
				style={{
					position: 'absolute',
					top: pointsTop,
					left: 60,
					right: 60,
					display: 'flex',
					flexDirection: 'column',
					gap: 18,
					alignItems: 'center',
				}}
			>
				{points.map((point, i) => {
					const startFrame = REVEAL_FRAMES + i * POINT_SLOT;
					if (frame < startFrame) return null;
					return (
						<StickerBadge
							key={i}
							text={point}
							color={palette.accents[i % palette.accents.length]!}
							seed={`${seed}-point-${i}`}
							delay={startFrame}
							maxWidth={contentWidth}
							maxFontSize={32}
							maxRotateDeg={7}
						/>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
