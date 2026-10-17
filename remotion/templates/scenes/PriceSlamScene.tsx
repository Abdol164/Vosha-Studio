import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {COLORS} from '../../types';
import {interFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {useShake, useSlam} from '../../components/motion';

export const PriceSlamScene: React.FC<{price: string}> = ({price}) => {
	const slam = useSlam(0);
	const translateY = interpolate(slam, [0, 1], [400, 0], {extrapolateRight: 'clamp'});
	const shake = useShake(8, 4, 6);

	return (
		<AbsoluteFill style={{backgroundColor: COLORS.white}}>
			<AbsoluteFill
				style={{
					backgroundColor: COLORS.signal,
					justifyContent: 'center',
					alignItems: 'center',
					border: `12px solid ${COLORS.ink}`,
					transform: `translate(${shake.x}px, ${translateY + shake.y}px)`,
				}}
			>
				<AutoFitText
					text={price}
					maxWidth={900}
					maxFontSize={180}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={COLORS.white}
					textTransform="none"
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
