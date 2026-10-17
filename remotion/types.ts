import {z} from 'zod';

export const dropCopySchema = z.object({
	hook: z.string(),
	lines: z.array(z.string()).min(1).max(3),
	cta: z.string(),
	caption: z.string(),
	hashtags: z.array(z.string()),
});

export type DropCopy = z.infer<typeof dropCopySchema>;

export const statusDropPropsSchema = z.object({
	productName: z.string().min(1).max(60),
	price: z.string().min(1).max(24),
	photoUrl: z.string(),
	points: z.array(z.string().min(1).max(80)).min(1).max(3),
	copy: dropCopySchema,
	handle: z.string().max(40).optional(),
	template: z.enum(['brutal', 'market']).default('brutal'),
	// Optional TTS voiceover track (MON-51) — same URL/staticFile resolution as photoUrl.
	// Renders silent when absent (no ElevenLabs key, or voiceover generation failed).
	voiceoverUrl: z.string().optional(),
});

export type StatusDropProps = z.infer<typeof statusDropPropsSchema>;

export const COLORS = {
	ink: '#0a0a0a',
	white: '#FFFFFF',
	signal: '#E60023',
} as const;
