import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {COLORS} from '../../types';
import {interFontFamily, jetBrainsMonoFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {useSlam} from '../../components/motion';

export const CTAScene: React.FC<{cta: string; handle?: string}> = ({cta, handle}) => {
	const slam = useSlam(0);
	const opacity = interpolate(slam, [0, 1], [0, 1], {extrapolateRight: 'clamp'});

	return (
		<AbsoluteFill
			style={{
				backgroundColor: COLORS.ink,
				justifyContent: 'center',
				alignItems: 'center',
				flexDirection: 'column',
				gap: 24,
			}}
		>
			<div style={{opacity}}>
				<AutoFitText
					text={cta}
					maxWidth={900}
					maxFontSize={100}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={COLORS.white}
					style={{margin: '0 auto'}}
				/>
			</div>
			{handle ? (
				<div
					style={{
						opacity,
						fontFamily: jetBrainsMonoFontFamily,
						fontWeight: 700,
						fontSize: 36,
						color: COLORS.signal,
						letterSpacing: 2,
					}}
				>
					{handle}
				</div>
			) : null}
		</AbsoluteFill>
	);
};
