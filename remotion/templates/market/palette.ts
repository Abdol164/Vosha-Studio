import {random} from 'remotion';

// Spec §8 stretch template: "yellow/green/red palette". Which of the three is the
// dominant background vs. the accent rotates per drop (seeded, not per-frame) so two
// renders of the same template don't default to looking identical.
export const MARKET_COLORS = {
	yellow: '#FFD600',
	green: '#00B341',
	red: '#FF2D2D',
	ink: '#0a0a0a',
	white: '#FFFFFF',
} as const;

const ROTATIONS: Array<readonly [string, string, string]> = [
	[MARKET_COLORS.yellow, MARKET_COLORS.green, MARKET_COLORS.red],
	[MARKET_COLORS.green, MARKET_COLORS.red, MARKET_COLORS.yellow],
	[MARKET_COLORS.red, MARKET_COLORS.yellow, MARKET_COLORS.green],
];

export interface MarketPalette {
	hookBg: string;
	accents: readonly [string, string, string];
}

export function pickMarketPalette(seed: string): MarketPalette {
	const rotation = ROTATIONS[Math.floor(random(`${seed}-palette`) * ROTATIONS.length)]!;
	return {hookBg: rotation[0], accents: rotation};
}
