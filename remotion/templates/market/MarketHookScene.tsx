import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {interFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {StickerBadge} from '../../components/StickerBadge';
import {useBouncyPop, useWobble} from '../../components/motion';
import {MARKET_COLORS, pickMarketPalette} from './palette';

export const MarketHookScene: React.FC<{hook: string; seed: string}> = ({hook, seed}) => {
	const pop = useBouncyPop(0);
	const scale = Math.max(0, interpolate(pop, [0, 1], [0.3, 1], {extrapolateRight: 'clamp'}));
	const wobble = useWobble(3, 55, 0);
	const palette = pickMarketPalette(seed);

	return (
		<AbsoluteFill style={{backgroundColor: palette.hookBg, justifyContent: 'center', alignItems: 'center'}}>
			<div style={{position: 'absolute', top: 60, left: 60}}>
				<StickerBadge
					text="NEW DROP!"
					color={MARKET_COLORS.ink}
					textColor={MARKET_COLORS.white}
					seed={`${seed}-hook-label`}
					delay={6}
				/>
			</div>
			<div
				style={{
					transform: `scale(${scale}) rotate(${wobble}deg)`,
					width: '85%',
					textAlign: 'center',
					border: `8px solid ${MARKET_COLORS.ink}`,
					backgroundColor: MARKET_COLORS.white,
					padding: '24px 20px',
				}}
			>
				<AutoFitText
					text={hook}
					maxWidth={820}
					maxFontSize={140}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={MARKET_COLORS.ink}
					style={{margin: '0 auto'}}
				/>
			</div>
		</AbsoluteFill>
	);
};
