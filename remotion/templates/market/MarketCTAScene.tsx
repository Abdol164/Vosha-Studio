import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {interFontFamily, jetBrainsMonoFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {StickerBadge} from '../../components/StickerBadge';
import {useBouncyPop} from '../../components/motion';
import {MARKET_COLORS, pickMarketPalette} from './palette';

export const MarketCTAScene: React.FC<{cta: string; handle?: string; seed: string}> = ({cta, handle, seed}) => {
	const pop = useBouncyPop(0);
	const scale = Math.max(0, interpolate(pop, [0, 1], [0.5, 1], {extrapolateRight: 'clamp'}));
	const palette = pickMarketPalette(seed);

	return (
		<AbsoluteFill
			style={{
				backgroundColor: MARKET_COLORS.ink,
				justifyContent: 'center',
				alignItems: 'center',
				flexDirection: 'column',
				gap: 28,
			}}
		>
			<div style={{transform: `scale(${scale})`}}>
				<AutoFitText
					text={cta}
					maxWidth={880}
					maxFontSize={100}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={MARKET_COLORS.white}
					style={{margin: '0 auto'}}
				/>
			</div>
			{handle ? (
				<div style={{transform: `scale(${scale})`}}>
					<StickerBadge
						text={handle}
						color={palette.accents[0]}
						seed={`${seed}-cta-handle`}
						delay={6}
						fontSize={30}
						style={{fontFamily: jetBrainsMonoFontFamily}}
					/>
				</div>
			) : null}
		</AbsoluteFill>
	);
};
