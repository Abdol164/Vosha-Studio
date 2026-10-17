import type {RequestHandler} from 'express';
import {dropRequestSchema} from './schema.js';

// Spec §6.3 ordering, mounted before the x402 middleware:
//   1. No body → pass through, so x402 answers 402. Agents probe paid endpoints with a
//      bodyless request to discover the price, and a 400 there would hide it.
//   2. A body that fails the schema → 400 here, before x402 verifies or settles anything.
// A paid request that arrives with no body still reaches the handler with no parsed
// drop, which answers 400, and @x402/express never settles a >= 400 response.
export function hasBody(body: unknown): boolean {
	if (body === undefined || body === null) return false;
	if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return false;
	return true;
}

export const validatePaid: RequestHandler = (req, res, next) => {
	if (!hasBody(req.body)) {
		next();
		return;
	}
	const parsed = dropRequestSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: 'invalid_request',
			message: 'Request body does not match the /drop schema.',
			issues: parsed.error.issues.map((i) => ({path: i.path.join('.'), message: i.message})),
		});
		return;
	}
	res.locals.drop = parsed.data;
	next();
};
