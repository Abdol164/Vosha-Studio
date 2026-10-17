import React from 'react';
import {COLORS} from '../types';
import {jetBrainsMonoFontFamily} from '../fonts';

export const IndexTag: React.FC<{index: number}> = ({index}) => (
	<div
		style={{
			backgroundColor: COLORS.signal,
			color: COLORS.white,
			fontFamily: jetBrainsMonoFontFamily,
			fontWeight: 700,
			fontSize: 28,
			padding: '6px 14px',
			border: `4px solid ${COLORS.ink}`,
			flexShrink: 0,
		}}
	>
		{String(index).padStart(2, '0')}
	</div>
);
