// Background music bed (MON-51 follow-up). Mixkit tracks (free, no attribution required
// — see https://mixkit.co/license/#music), stored in public/music/. Each track's real
// beat kicks in well after 0:00 (typical of these loop-style trap/hip-hop instrumentals),
// so playback starts partway in rather than at the quiet intro. One is picked at random
// per render for variety across drops.

export interface MusicTrack {
	file: string;
	// Where the "real" beat starts, in seconds — skips the intro/buildup.
	startOffsetSeconds: number;
}

export const MUSIC_TRACKS: MusicTrack[] = [
	{file: 'music/mixkit-sparta-370.mp3', startOffsetSeconds: 15},
	{file: 'music/mixkit-waka-floka-type-364.mp3', startOffsetSeconds: 15},
	{file: 'music/mixkit-party-303.mp3', startOffsetSeconds: 15},
];

export function pickRandomTrack(): MusicTrack {
	return MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)]!;
}
