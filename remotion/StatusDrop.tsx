import React from 'react';
import {staticFile} from 'remotion';
import type {StatusDropProps} from './types';
import {Brutal} from './templates/Brutal';

// photoUrl is either a remote http(s) URL (the server's downloaded+resized image)
// or a public/ filename (local sample renders) — resolved to a servable URL here.
const resolvePhotoUrl = (photoUrl: string) =>
	/^https?:\/\//.test(photoUrl) ? photoUrl : staticFile(photoUrl);

export const StatusDrop: React.FC<StatusDropProps> = (props) => {
	const resolved = {...props, photoUrl: resolvePhotoUrl(props.photoUrl)};

	// `market` is the stretch template (spec §8) — not built yet, falls back to `brutal`.
	switch (resolved.template) {
		case 'market':
		case 'brutal':
		default:
			return <Brutal {...resolved} />;
	}
};
