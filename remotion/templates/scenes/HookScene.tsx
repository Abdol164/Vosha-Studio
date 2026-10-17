import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {COLORS} from '../../types';
import {interFontFamily} from '../../fonts';
import {MonoLabel} from '../../components/MonoLabel';
import {AutoFitText} from '../../components/AutoFitText';
import {useSlam} from '../../components/motion';

export const HookScene: React.FC<{hook: string}> = ({hook}) => {
	const slam = useSlam(0);
	const scale = interpolate(slam, [0, 1], [0.6, 1], {extrapolateRight: 'clamp'});

	return (
		<AbsoluteFill
			style={{
				backgroundColor: COLORS.signal,
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
			<div style={{position: 'absolute', top: 60, left: 60}}>
				<MonoLabel color={COLORS.white}>VOSHA STUDIO // NEW DROP</MonoLabel>
			</div>
			<div style={{transform: `scale(${scale})`, width: '85%', textAlign: 'center'}}>
				<AutoFitText
					text={hook}
					maxWidth={900}
					maxFontSize={160}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={COLORS.white}
					style={{margin: '0 auto'}}
				/>
			</div>
		</AbsoluteFill>
	);
};
