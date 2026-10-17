import {z} from 'zod';

// POST /drop body. Mirrors dropInputSchema in plugin/src/plugin.ts, except photo_url must
// be https: fetchPhoto refuses anything else, so failing here gives a clearer 400.
export const dropRequestSchema = z
	.object({
		product_name: z.string().min(1).max(60),
		price: z.string().min(1).max(24),
		photo_url: z.url({protocol: /^https$/}),
		points: z.array(z.string().min(1).max(80)).min(1).max(3),
		language: z.enum(['en', 'pcg', 'yo']).optional(),
		template: z.enum(['brutal', 'market']).optional(),
		handle: z.string().max(40).optional(),
		cta: z.string().max(24).optional(),
	})
	.strict();

export type DropRequest = z.infer<typeof dropRequestSchema>;
