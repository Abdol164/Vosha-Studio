import React from 'react';
import {Audio, Sequence} from 'remotion';

interface VoiceoverTrackProps {
	clips: Partial<Record<string, string>>;
	segmentKey: string;
	from: number;
	durationInFrames: number;
}

// Places one voiceover clip (already resolved to a servable URL) inside a Sequence at
// a GLOBAL frame offset matching its story beat's visual reveal — wrapping in Sequence
// both starts it at the right moment and hard-caps its length, so an unexpectedly long
// clip gets cut at the next beat rather than bleeding into it.
export const VoiceoverTrack: React.FC<VoiceoverTrackProps> = ({clips, segmentKey, from, durationInFrames}) => {
	const src = clips[segmentKey];
	if (!src) {
		return null;
	}
	return (
		<Sequence from={from} durationInFrames={durationInFrames}>
			<Audio src={src} />
		</Sequence>
	);
};
