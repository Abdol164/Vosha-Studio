import type {RequestHandler} from 'express';
import {HTTPFacilitatorClient} from '@x402/core/server';
import {ExactEvmScheme} from '@x402/evm/exact/server';
import {paymentMiddleware, x402ResourceServer} from '@x402/express';

// USDC per network. Spelled out (rather than letting @x402/evm pick its default asset)
// so the address we charge in is pinned and reviewable. name/version are USDC's EIP-712
// domain, which differs between the two deployments.
export const NETWORKS = {
	'base-sepolia': {
		network: 'eip155:84532',
		usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
		eip712: {name: 'USDC', version: '2'},
	},
	base: {
		network: 'eip155:8453',
		usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		eip712: {name: 'USD Coin', version: '2'},
	},
} as const;

export type NetworkName = keyof typeof NETWORKS;

export const DEFAULT_FACILITATOR_URL = 'https://facilitator.payai.network';
// The payer's signed authorization has to outlive queue wait + render (~25s) + settle,
// because settlement only happens after the response is ready.
export const PAYMENT_TIMEOUT_SECONDS = 300;
export const PAYMENT_DESCRIPTION =
	'Vosha Studio: a 10-second 1080x1920 promo video (MP4) + poster + caption from a product photo, price and up to 3 selling points.';

export interface X402Config {
	network: NetworkName;
	facilitatorUrl: string;
	payTo: `0x${string}`;
	// USDC atomic units (6 decimals).
	amount: string;
	resource: string;
}

export function usdToAtomic(usd: string): string {
	if (!/^\d+(\.\d{1,6})?$/.test(usd)) {
		throw new Error(`PRICE_USD must be a plain decimal with at most 6 places, got ${JSON.stringify(usd)}`);
	}
	const [whole = '0', frac = ''] = usd.split('.');
	const atomic = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
	if (atomic <= 0n) throw new Error('PRICE_USD must be greater than 0');
	return atomic.toString();
}

// Fails loudly at startup: a typo here means taking money on the wrong chain or to the
// wrong address, so there are no silent defaults for PAYOUT_ADDRESS.
export function x402ConfigFromEnv(env: NodeJS.ProcessEnv, publicBaseUrl: string): X402Config {
	const network = (env.X402_NETWORK ?? 'base-sepolia') as NetworkName;
	if (!(network in NETWORKS)) {
		throw new Error(`X402_NETWORK must be one of ${Object.keys(NETWORKS).join(', ')}, got ${JSON.stringify(network)}`);
	}
	const payTo = env.PAYOUT_ADDRESS ?? '';
	if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
		throw new Error('PAYOUT_ADDRESS must be set to a 0x-prefixed 20-byte address');
	}
	return {
		network,
		facilitatorUrl: env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL,
		payTo: payTo as `0x${string}`,
		amount: usdToAtomic(env.PRICE_USD || '0.25'),
		resource: `${publicBaseUrl.replace(/\/+$/, '')}/drop`,
	};
}

export function createPaidMiddleware(config: X402Config): RequestHandler {
	const {network, usdc, eip712} = NETWORKS[config.network];
	const server = new x402ResourceServer(new HTTPFacilitatorClient({url: config.facilitatorUrl})).register(
		network,
		new ExactEvmScheme(),
	);
	return paymentMiddleware(
		{
			'POST /drop': {
				accepts: {
					scheme: 'exact',
					network,
					payTo: config.payTo,
					price: {amount: config.amount, asset: usdc, extra: {...eip712}},
					maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
				},
				resource: config.resource,
				description: PAYMENT_DESCRIPTION,
				mimeType: 'application/json',
				serviceName: 'Vosha Studio',
			},
		},
		server,
	);
}
