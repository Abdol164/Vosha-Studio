import {spring, useCurrentFrame, useVideoConfig} from 'remotion';

// Heavy, mechanical "slam into place": high stiffness + low damping overshoots
// a few frames past its resting value before settling — the brutalist "jolt".
export const useSlam = (delay = 0) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	return spring({
		frame: frame - delay,
		fps,
		config: {
			damping: 10,
			mass: 0.6,
			stiffness: 180,
		},
	});
};

// Short decaying screen-shake on impact (e.g. the price block landing).
export const useShake = (startFrame: number, durationFrames = 4, magnitude = 6) => {
	const frame = useCurrentFrame();
	const t = frame - startFrame;
	if (t < 0 || t > durationFrames) {
		return {x: 0, y: 0};
	}
	const decay = 1 - t / durationFrames;
	return {
		x: Math.sin(t * 10) * magnitude * decay,
		y: Math.cos(t * 13) * magnitude * decay,
	};
};
