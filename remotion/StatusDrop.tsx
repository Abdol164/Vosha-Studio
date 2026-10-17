import React from 'react';
import {staticFile} from 'remotion';
import type {StatusDropProps} from './types';
import {Brutal} from './templates/Brutal';

// photoUrl/voiceoverUrl are each either a remote http(s) URL (the server's generated
// asset) or a public/ filename (local sample renders) — resolved to a servable URL here.
const resolveAssetUrl = (url: string) => (/^https?:\/\//.test(url) ? url : staticFile(url));

export const StatusDrop: React.FC<StatusDropProps> = (props) => {
	const resolved = {
		...props,
		photoUrl: resolveAssetUrl(props.photoUrl),
		voiceoverUrl: props.voiceoverUrl ? resolveAssetUrl(props.voiceoverUrl) : undefined,
		musicUrl: props.musicUrl ? resolveAssetUrl(props.musicUrl) : undefined,
	};

	// `market` is the stretch template (spec §8) — not built yet, falls back to `brutal`.
	switch (resolved.template) {
		case 'market':
		case 'brutal':
		default:
			return <Brutal {...resolved} />;
	}
};
