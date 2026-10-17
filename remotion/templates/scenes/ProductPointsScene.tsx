import React from 'react';
import {AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS} from '../../types';
import {interFontFamily} from '../../fonts';
import {AutoFitText} from '../../components/AutoFitText';
import {IndexTag} from '../../components/IndexTag';
import {useSlam} from '../../components/motion';

const REVEAL_FRAMES = 84; // local 0-84: product reveal, matches spec frames 36-120
const POINT_SLOT = 35; // 3 points * 35 = 105 frames, matches spec frames 120-225

export const ProductPointsScene: React.FC<{
	photoUrl: string;
	productName: string;
	points: string[];
}> = ({photoUrl, productName, points}) => {
	const frame = useCurrentFrame();
	const {width, height} = useVideoConfig();

	const photoJolt = useSlam(0);
	const photoScale = interpolate(photoJolt, [0, 1], [1.15, 1], {
		extrapolateRight: 'clamp',
	});

	const nameBarSlam = useSlam(10);
	const nameBarY = interpolate(nameBarSlam, [0, 1], [80, 0], {
		extrapolateRight: 'clamp',
	});

	// Photo shrinks from a large reveal block to a top-half strip as points take over.
	const photoHeightPx = interpolate(
		frame,
		[REVEAL_FRAMES - 20, REVEAL_FRAMES],
		[height * 0.62, height * 0.36],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	const photoTop = 90;
	const nameBarTop = photoTop + photoHeightPx + 24;
	const pointsTop = nameBarTop + 100;

	return (
		<AbsoluteFill style={{backgroundColor: COLORS.white}}>
			<div
				style={{
					position: 'absolute',
					top: photoTop,
					left: '50%',
					transform: `translateX(-50%) scale(${photoScale})`,
					width: width - 160,
					height: photoHeightPx,
					border: `10px solid ${COLORS.ink}`,
					backgroundColor: COLORS.white,
					overflow: 'hidden',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<Img src={photoUrl} style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} />
			</div>

			<div
				style={{
					position: 'absolute',
					top: nameBarTop,
					left: 80,
					right: 80,
					transform: `translateY(${nameBarY}px)`,
					backgroundColor: COLORS.ink,
					padding: '18px 24px',
				}}
			>
				<AutoFitText
					text={productName}
					maxWidth={width - 160 - 48}
					maxFontSize={56}
					fontFamily={interFontFamily}
					fontWeight={900}
					color={COLORS.white}
				/>
			</div>

			<div
				style={{
					position: 'absolute',
					top: pointsTop,
					left: 80,
					right: 80,
					display: 'flex',
					flexDirection: 'column',
					gap: 18,
				}}
			>
				{points.map((point, i) => {
					const startFrame = REVEAL_FRAMES + i * POINT_SLOT;
					if (frame < startFrame) {
						return null;
					}
					const progress = interpolate(frame, [startFrame, startFrame + 12], [0, 1], {
						extrapolateLeft: 'clamp',
						extrapolateRight: 'clamp',
					});
					const translateX = interpolate(progress, [0, 1], [-60, 0]);

					return (
						<div
							key={i}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 16,
								opacity: progress,
								transform: `translateX(${translateX}px)`,
							}}
						>
							<IndexTag index={i + 1} />
							<div style={{flex: 1, backgroundColor: COLORS.ink, padding: '14px 20px'}}>
								<AutoFitText
									text={point}
									maxWidth={width - 160 - 140}
									maxFontSize={38}
									fontFamily={interFontFamily}
									fontWeight={600}
									color={COLORS.white}
									textTransform="none"
								/>
							</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};
