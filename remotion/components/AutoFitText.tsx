import React from 'react';
import {fitText} from '@remotion/layout-utils';

interface AutoFitTextProps {
	text: string;
	maxWidth: number;
	maxFontSize: number;
	fontFamily: string;
	fontWeight?: number | string;
	color?: string;
	textTransform?: 'uppercase' | 'none';
	lineHeight?: number;
	style?: React.CSSProperties;
}

// Shrinks a single line of text to fit maxWidth (never overflows), capped at maxFontSize.
// Long product names / points stay on one line at a smaller size rather than wrapping or clipping.
export const AutoFitText: React.FC<AutoFitTextProps> = ({
	text,
	maxWidth,
	maxFontSize,
	fontFamily,
	fontWeight = 900,
	color = '#FFFFFF',
	textTransform = 'uppercase',
	lineHeight = 1,
	style,
}) => {
	const displayText = textTransform === 'uppercase' ? text.toUpperCase() : text;

	const {fontSize} = fitText({
		text: displayText,
		fontFamily,
		fontWeight,
		withinWidth: maxWidth,
	});

	const resolvedFontSize = Math.min(fontSize, maxFontSize);

	return (
		<div
			style={{
				fontFamily,
				fontWeight,
				fontSize: resolvedFontSize,
				color,
				lineHeight,
				whiteSpace: 'nowrap',
				width: 'fit-content',
				...style,
			}}
		>
			{displayText}
		</div>
	);
};
