import React from 'react';
import {staticFile} from 'remotion';
import type {StatusDropProps} from './types';
import {Brutal} from './templates/Brutal';
import {Market} from './templates/Market';

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

	switch (resolved.template) {
		case 'market':
			return <Market {...resolved} />;
		case 'brutal':
		default:
			return <Brutal {...resolved} />;
	}
};
