import React from 'react';
import {AbsoluteFill, interpolate, useVideoConfig} from 'remotion';
import {interFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {Confetti} from '../../components/Confetti';
import {Starburst} from '../../components/Starburst';
import {useBouncyPop, useWobble} from '../../components/motion';
import {MARKET_COLORS, pickMarketPalette} from './palette';

export const MarketPriceBurstScene: React.FC<{price: string; seed: string}> = ({price, seed}) => {
	const {width, height} = useVideoConfig();
	const pop = useBouncyPop(0);
	const scale = Math.max(0, interpolate(pop, [0, 1], [0, 1], {extrapolateRight: 'clamp'}));
	const spin = interpolate(pop, [0, 1], [-20, 0], {extrapolateRight: 'clamp'});
	const wobble = useWobble(2, 50, 0);
	const palette = pickMarketPalette(seed);
	const burstSize = Math.min(width, height) * 0.85;

	return (
		<AbsoluteFill style={{backgroundColor: MARKET_COLORS.white, justifyContent: 'center', alignItems: 'center'}}>
			<Confetti
				count={18}
				colors={palette.accents}
				seed={`${seed}-price-confetti`}
				startFrame={0}
				areaWidth={width}
				areaHeight={height}
			/>
			<div
				style={{
					position: 'relative',
					width: burstSize,
					height: burstSize,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<Starburst
					size={burstSize}
					color={palette.accents[2]}
					seed={seed}
					style={{transform: `scale(${scale}) rotate(${spin + wobble}deg)`}}
				/>
				<div style={{position: 'relative', transform: `scale(${scale})`}}>
					<AutoFitText
						text={price}
						maxWidth={burstSize * 0.62}
						maxFontSize={160}
						fontFamily={interFontFamily}
						fontWeight={900}
						// Ink, not white: the burst's accent color can be yellow, which white
						// text would barely read against.
						color={MARKET_COLORS.ink}
						textTransform="none"
						style={{margin: '0 auto', textAlign: 'center'}}
					/>
				</div>
			</div>
		</AbsoluteFill>
	);
};
