import React from 'react';
import {jetBrainsMonoFontFamily} from '../fonts';

export const MonoLabel: React.FC<{
	children: string;
	color?: string;
	fontSize?: number;
}> = ({children, color = '#FFFFFF', fontSize = 28}) => (
	<div
		style={{
			fontFamily: jetBrainsMonoFontFamily,
			fontWeight: 700,
			fontSize,
			color,
			letterSpacing: 2,
			textTransform: 'uppercase',
		}}
	>
		{children}
	</div>
);
