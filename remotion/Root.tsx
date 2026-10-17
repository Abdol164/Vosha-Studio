import React from 'react';
import {Composition} from 'remotion';
import {StatusDrop} from './StatusDrop';
import {statusDropPropsSchema} from './types';

const defaultProps = {
	productName: "Nike Air Force 1 '07",
	price: '₦45,000',
	photoUrl: 'sample-product.png',
	points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
	copy: {
		hook: 'NEW DROP',
		lines: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
		cta: 'DM to order',
		caption: 'Original AF1 don land! Sizes 40-45, free delivery for Minna. DM now.',
		hashtags: ['#AF1', '#NaijaKicks', '#MinnaSellers'],
	},
	handle: '@shoebaby_minna',
	template: 'brutal' as const,
};

export const RemotionRoot: React.FC = () => {
	return (
		<Composition
			id="StatusDrop"
			component={StatusDrop}
			durationInFrames={300}
			fps={30}
			width={1080}
			height={1920}
			schema={statusDropPropsSchema}
			defaultProps={defaultProps}
		/>
	);
};
