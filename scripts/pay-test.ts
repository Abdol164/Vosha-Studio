// Real-money check of the paid /drop flow (MON-41). Spends PRICE_USD of USDC from
// TEST_PAYER_PRIVATE_KEY once per run (check c); checks a and b must move nothing.
//
//   TEST_PAYER_PRIVATE_KEY=0x... X402_NETWORK=base-sepolia bun run pay-test [base-url]
//
// base-url defaults to PUBLIC_BASE_URL, then http://127.0.0.1:$PORT.
import '../src/env.js';
import {ExactEvmScheme} from '@x402/evm';
import {wrapFetchWithPaymentFromConfig} from '@x402/fetch';
import {createPublicClient, erc20Abi, http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {base, baseSepolia} from 'viem/chains';
import {NETWORKS, type NetworkName} from '../src/x402.js';

const BODY = {
	product_name: "Nike Air Force 1 '07",
	price: '₦45,000',
	photo_url: 'https://raw.githubusercontent.com/Abdol164/Vosha-Studio/main/public/sample-product.png',
	points: ['100% original', 'Sizes 40 to 45', 'Free delivery within Minna'],
	language: 'pcg',
	handle: '@shoebaby_minna',
};

const key = process.env.TEST_PAYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
	console.error('TEST_PAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key');
	process.exit(1);
}
const networkName = (process.env.X402_NETWORK ?? 'base-sepolia') as NetworkName;
const net = NETWORKS[networkName];
if (!net) {
	console.error(`X402_NETWORK must be one of ${Object.keys(NETWORKS).join(', ')}`);
	process.exit(1);
}
const baseUrl = (
	process.argv[2] ||
	process.env.PUBLIC_BASE_URL ||
	`http://127.0.0.1:${process.env.PORT ?? '3000'}`
).replace(/\/+$/, '');

const account = privateKeyToAccount(key as `0x${string}`);
const chain = networkName === 'base' ? base : baseSepolia;
const rpc = createPublicClient({chain, transport: http()});
const balance = () =>
	rpc.readContract({address: net.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address]});
const usdc = (n: bigint) => `${Number(n) / 1e6} USDC`;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures++;
}

// Pays on the 402 retry; `paidBody` swaps the body on that retry, to send a real payment
// header alongside an invalid body (check b).
function payingFetch(paidBody?: unknown) {
	let paid = 0;
	const inner: typeof fetch = async (input, init) => {
		const req = new Request(input, init);
		if (req.headers.has('payment-signature')) {
			paid++;
			if (paidBody !== undefined) return fetch(new Request(req, {body: JSON.stringify(paidBody)}));
		}
		return fetch(req);
	};
	const f = wrapFetchWithPaymentFromConfig(inner, {schemes: [{network: net.network, client: new ExactEvmScheme(account)}]});
	return {f, paidAttempts: () => paid};
}

const post = (f: typeof fetch, body?: unknown) =>
	f(`${baseUrl}/drop`, {
		method: 'POST',
		headers: body === undefined ? {} : {'content-type': 'application/json'},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

async function waitForBalanceBelow(start: bigint, timeoutMs = 30_000): Promise<bigint> {
	const deadline = Date.now() + timeoutMs;
	let now = await balance();
	while (now >= start && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 2_000));
		now = await balance();
	}
	return now;
}

console.log(`Target ${baseUrl}  network ${net.network}  payer ${account.address}`);
const start = await balance();
console.log(`Payer balance: ${usdc(start)}\n`);

// (a) bodyless → 402 with requirements we expect
{
	const res = await post(fetch);
	const header = res.headers.get('payment-required');
	check('(a) bodyless POST → 402', res.status === 402, `got ${res.status}`);
	if (header) {
		const accept = JSON.parse(Buffer.from(header, 'base64').toString('utf8')).accepts?.[0] ?? {};
		check('(a) 402 asks for USDC on the right chain', accept.network === net.network && accept.asset === net.usdc);
		console.log(`      amount ${accept.amount} → payTo ${accept.payTo}`);
		if (start < BigInt(accept.amount ?? 0)) {
			console.error(`\nPayer has ${usdc(start)}, needs ${usdc(BigInt(accept.amount))}. Fund it and rerun.`);
			process.exit(1);
		}
	} else {
		check('(a) PAYMENT-REQUIRED header present', false);
	}
}

// (b) signed payment + invalid body → 400, nothing moves
{
	const {f, paidAttempts} = payingFetch({...BODY, points: []});
	const res = await post(f, BODY);
	check('(b) paid POST with bad body → 400', res.status === 400 && paidAttempts() === 1, `got ${res.status}, paid attempts ${paidAttempts()}`);
	await new Promise((r) => setTimeout(r, 5_000));
	const after = await balance();
	check('(b) no USDC moved', after === start, `${usdc(start)} → ${usdc(after)}`);
}

// (c) paid valid → 200, URLs work, exactly one charge
{
	const {f} = payingFetch();
	const t0 = Date.now();
	const res = await post(f, BODY);
	const body = (await res.json().catch(() => ({}))) as Record<string, string>;
	check('(c) paid valid POST → 200', res.status === 200, `got ${res.status} in ${Math.round((Date.now() - t0) / 1000)}s`);
	console.log(`      ${JSON.stringify(body)}`);
	const receipt = res.headers.get('payment-response');
	if (receipt) {
		const settle = JSON.parse(Buffer.from(receipt, 'base64').toString('utf8'));
		console.log(`      tx ${settle.transaction}`);
	}
	for (const k of ['video_url', 'poster_url', 'page_url']) {
		const url = body[k];
		const r = url ? await fetch(url, {method: 'GET'}) : null;
		check(`(c) ${k} loads`, r?.status === 200, url ?? 'missing');
	}
	const after = await waitForBalanceBelow(start);
	check('(c) payer was charged', after < start, `${usdc(start)} → ${usdc(after)}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
