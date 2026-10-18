import assert from 'node:assert/strict';
import fs from 'node:fs';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {after, before, beforeEach, describe, test} from 'node:test';
import {ExactEvmScheme} from '@x402/evm';
import {wrapFetchWithPaymentFromConfig} from '@x402/fetch';
import express from 'express';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {type AppDeps, createApp} from '../src/app.js';
import {RenderQueue} from '../src/queue.js';
import {type DropRecord, ensureDataDirs, getDrop, mediaDir} from '../src/store.js';
import {hasBody} from '../src/validate-paid.js';
import {NETWORKS, createPaidMiddleware, usdToAtomic, x402ConfigFromEnv} from '../src/x402.js';

// Spec §6.3 ordering, checked against the real @x402/express middleware with a fake
// facilitator that counts verify/settle calls instead of touching a chain.

const PAYOUT = '0x1111111111111111111111111111111111111111';
const VALID = {
	product_name: 'AF1',
	price: '₦45,000',
	photo_url: 'https://example.com/a.jpg',
	points: ['original'],
};

const calls = {verify: 0, settle: 0};
let renderImpl: AppDeps['render'];
let servers: Server[] = [];
let baseUrl: string;

function listen(app: express.Express): Promise<string> {
	return new Promise((resolve) => {
		const server = app.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
		servers.push(server);
	});
}

before(async () => {
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vosha-x402-'));
	await ensureDataDirs();

	const facilitator = express().use(express.json());
	facilitator.get('/supported', (_req, res) => {
		res.json({kinds: [{x402Version: 2, scheme: 'exact', network: 'eip155:84532'}], extensions: [], signers: {}});
	});
	facilitator.post('/verify', (req, res) => {
		calls.verify++;
		res.json({isValid: true, payer: req.body.paymentPayload?.payload?.authorization?.from});
	});
	facilitator.post('/settle', (_req, res) => {
		calls.settle++;
		res.json({success: true, transaction: `0x${'ab'.repeat(32)}`, network: 'eip155:84532'});
	});
	const facilitatorUrl = await listen(facilitator);

	const config = x402ConfigFromEnv(
		{X402_NETWORK: 'base-sepolia', PAYOUT_ADDRESS: PAYOUT, X402_FACILITATOR_URL: facilitatorUrl},
		'https://drop.test',
	);
	const app = createApp({
		fetchPhoto: async () => ({data: Buffer.from('x'), format: 'jpeg', width: 1, height: 1}),
		writeCopy: async () => ({hook: 'H', lines: ['l'], cta: 'c', caption: 'cap', hashtags: []}),
		generateVoiceover: async () => null,
		pickTrack: () => ({file: 'music/test.mp3', startOffsetSeconds: 15}),
		render: (id, props) => renderImpl(id, props),
		queue: new RenderQueue(1, 5),
		publicBaseUrl: 'https://drop.test',
		internalBaseUrl: 'http://127.0.0.1:9',
		paid: [createPaidMiddleware(config)],
	});
	baseUrl = await listen(app);
});

after(() => {
	for (const s of servers) s.close();
	servers = [];
});

beforeEach(() => {
	calls.verify = 0;
	calls.settle = 0;
	renderImpl = async (id) => {
		fs.writeFileSync(path.join(mediaDir(), `${id}.mp4`), 'mp4');
		return {video: `${id}.mp4`, poster: `${id}.jpg`};
	};
});

const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
	schemes: [{network: 'eip155:84532', client: new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))}],
});

const post = (f: typeof fetch, body?: unknown) =>
	f(`${baseUrl}/drop`, {
		method: 'POST',
		headers: body === undefined ? {} : {'content-type': 'application/json'},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

// POST /drop now settles on a fast 202 ack, before the render even starts (see
// src/drop-job.ts) -- so "did the render succeed" is observed by polling the record it
// updates, not by the HTTP response.
async function waitForStatus(id: string, timeoutMs = 2000): Promise<DropRecord> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const drop = await getDrop(id);
		if (drop && drop.status !== 'rendering') return drop;
		if (Date.now() > deadline) throw new Error(`drop ${id} still 'rendering' after ${timeoutMs}ms`);
		await new Promise((r) => setTimeout(r, 20));
	}
}

describe('x402 ordering (spec §6.3)', () => {
	test('(1) bodyless POST → 402 with our payment requirements', async () => {
		const res = await post(fetch);
		assert.equal(res.status, 402);
		const header = res.headers.get('payment-required');
		assert.ok(header, 'PAYMENT-REQUIRED header');
		const required = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
		const [accept] = required.accepts;
		assert.equal(accept.network, 'eip155:84532');
		assert.equal(accept.asset, NETWORKS['base-sepolia'].usdc);
		assert.equal(accept.amount, '250000');
		assert.equal(accept.payTo, PAYOUT);
		assert.equal(accept.maxTimeoutSeconds, 300);
		assert.equal(required.resource.url, 'https://drop.test/drop');
		// The body mirrors the header, for clients that read the challenge from the body.
		assert.deepEqual(await res.json(), required);
	});

	test('valid body without payment → 402', async () => {
		assert.equal((await post(fetch, VALID)).status, 402);
	});

	test('(2) invalid body → 400 before any verify/settle, even when paying', async () => {
		const res = await post(payingFetch, {...VALID, extra: 1});
		assert.equal(res.status, 400);
		assert.equal(calls.verify, 0);
		assert.equal(calls.settle, 0);
	});

	test('(2b) signed payment header + invalid body → 400, nothing verified or settled', async () => {
		// Probe with a valid body to get the 402, then swap in a bad body on the paid retry.
		let paidAttempts = 0;
		const swapBody: typeof fetch = async (input, init) => {
			const req = new Request(input, init);
			if (req.headers.has('payment-signature')) {
				paidAttempts++;
				return fetch(new Request(req, {body: JSON.stringify({...VALID, points: []})}));
			}
			return fetch(req);
		};
		const f = wrapFetchWithPaymentFromConfig(swapBody, {
			schemes: [{network: 'eip155:84532', client: new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))}],
		});
		const res = await post(f, VALID);
		assert.equal(paidAttempts, 1);
		assert.equal(res.status, 400);
		assert.equal(calls.verify, 0);
		assert.equal(calls.settle, 0);
	});

	test('(3) render failure → settles anyway (fast ack already happened), record ends up failed', async () => {
		renderImpl = async () => {
			throw new Error('chrome died');
		};
		const res = await post(payingFetch, VALID);
		assert.equal(res.status, 202);
		assert.equal(calls.verify, 1);
		assert.equal(calls.settle, 1);
		const {id} = (await res.json()) as {id: string};
		const drop = await waitForStatus(id);
		assert.equal(drop.status, 'failed');
		assert.equal(drop.error, 'render_failed');
	});

	// The old version of this test (client disconnects while the render is still running)
	// no longer applies: settlement now happens on the fast 202 ack, before the render even
	// starts, so there's nothing left running that a disconnect could race against. The
	// disconnect-before-the-ack window still matters (see the clientGone guard in
	// src/app.ts) but it's a sub-millisecond race around one local fs write with no
	// injectable seam in AppDeps to test deterministically -- an accepted coverage gap.

	test('paid valid request → fast 202 ack, settled immediately, record finishes "done" afterward', async () => {
		const res = await post(payingFetch, VALID);
		assert.equal(res.status, 202);
		const body = (await res.json()) as {id: string; status: string; page_url: string};
		assert.match(body.id, /^drp_/);
		assert.equal(body.status, 'rendering');
		assert.equal(body.page_url, `https://drop.test/d/${body.id}`);
		// Settlement is synchronous with this response, not deferred until the render finishes.
		assert.equal(calls.verify, 1);
		assert.equal(calls.settle, 1);
		assert.ok(res.headers.get('payment-response'));

		const drop = await waitForStatus(body.id);
		assert.equal(drop.status, 'done');
		assert.match(drop.video ?? '', /^drp_/);
		assert.match(drop.poster ?? '', /^drp_/);
	});
});

describe('x402 config', () => {
	test('usdToAtomic', () => {
		assert.equal(usdToAtomic('0.25'), '250000');
		assert.equal(usdToAtomic('1'), '1000000');
		assert.equal(usdToAtomic('0.000001'), '1');
		for (const bad of ['', '0', '-1', '1e3', '0.0000001', 'abc']) {
			assert.throws(() => usdToAtomic(bad), bad);
		}
	});

	test('network picks chain + USDC', () => {
		const main = x402ConfigFromEnv({X402_NETWORK: 'base', PAYOUT_ADDRESS: PAYOUT}, 'https://x');
		assert.equal(NETWORKS[main.network].network, 'eip155:8453');
		assert.equal(NETWORKS[main.network].usdc, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
		assert.equal(main.facilitatorUrl, 'https://facilitator.payai.network');
		assert.equal(main.amount, '250000');
	});

	test('refuses bad network or payout address', () => {
		assert.throws(() => x402ConfigFromEnv({X402_NETWORK: 'ethereum', PAYOUT_ADDRESS: PAYOUT}, 'https://x'));
		assert.throws(() => x402ConfigFromEnv({X402_NETWORK: 'base'}, 'https://x'));
		assert.throws(() => x402ConfigFromEnv({PAYOUT_ADDRESS: '0x123'}, 'https://x'));
	});

	test('hasBody', () => {
		assert.equal(hasBody(undefined), false);
		assert.equal(hasBody({}), false);
		assert.equal(hasBody({a: 1}), true);
		assert.equal(hasBody([]), true);
	});
});
