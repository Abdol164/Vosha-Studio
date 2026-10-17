import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {after, before, describe, test} from 'node:test';
import sharp from 'sharp';
import {MAX_PHOTO_BYTES, createPhotoFetcher, fetchPhoto, isPublicAddress, processPhoto} from '../src/image.js';

describe('isPublicAddress', () => {
	const blocked = [
		'127.0.0.1',
		'127.255.255.254',
		'0.0.0.0',
		'10.1.2.3',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.1',
		'169.254.169.254', // AWS/GCP/Azure metadata
		'100.100.100.200', // Alibaba metadata (CGNAT range)
		'100.64.0.1',
		'192.0.0.1',
		'198.18.0.1',
		'224.0.0.1',
		'255.255.255.255',
		'::',
		'::1',
		'fe80::1',
		'fc00::1',
		'fd00:ec2::254', // AWS IPv6 metadata
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'::ffff:169.254.169.254',
		'::ffff:a9fe:a9fe',
		'64:ff9b::a9fe:a9fe',
		'2001:db8::1',
		'2002:7f00:1::1',
		'2001:0:4136:e378::1',
		'not-an-ip',
	];
	for (const ip of blocked) {
		test(`blocks ${ip}`, () => assert.equal(isPublicAddress(ip), false));
	}

	const allowed = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];
	for (const ip of allowed) {
		test(`allows ${ip}`, () => assert.equal(isPublicAddress(ip), true));
	}
});

describe('fetchPhoto URL checks (strict policy, no network needed)', () => {
	const cases: Array<[string, string]> = [
		['http://example.com/a.jpg', 'photo_invalid_url'],
		['ftp://example.com/a.jpg', 'photo_invalid_url'],
		['file:///etc/passwd', 'photo_invalid_url'],
		['not a url', 'photo_invalid_url'],
		['https://user:pass@example.com/a.jpg', 'photo_invalid_url'],
		['https://example.com:8443/a.jpg', 'photo_invalid_url'],
		['https://127.0.0.1/a.jpg', 'photo_blocked_host'],
		['https://169.254.169.254/latest/meta-data/', 'photo_blocked_host'],
		['https://[::1]/a.jpg', 'photo_blocked_host'],
		['https://[::ffff:127.0.0.1]/a.jpg', 'photo_blocked_host'],
		['https://0x7f.1/a.jpg', 'photo_blocked_host'], // WHATWG URL normalises to 127.0.0.1
		['https://2130706433/a.jpg', 'photo_blocked_host'], // decimal 127.0.0.1
		['https://0/a.jpg', 'photo_blocked_host'],
		['https://localhost/a.jpg', 'photo_blocked_host'], // goes through the DNS lookup guard
		[`https://example.com/${'a'.repeat(2100)}`, 'photo_invalid_url'],
	];
	for (const [url, code] of cases) {
		test(`${url.slice(0, 60)} -> ${code}`, async () => {
			await assert.rejects(fetchPhoto(url), {code});
		});
	}
});

describe('processPhoto', () => {
	test('resizes landscape JPEG to 1080 long edge', async () => {
		const input = await sharp({create: {width: 3000, height: 2000, channels: 3, background: '#c33'}}).jpeg().toBuffer();
		const out = await processPhoto(input);
		assert.equal(out.format, 'jpeg');
		assert.deepEqual([out.width, out.height], [1080, 720]);
	});

	test('keeps transparent PNG as PNG', async () => {
		const input = await sharp({create: {width: 500, height: 1000, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}})
			.png()
			.toBuffer();
		const out = await processPhoto(input);
		assert.equal(out.format, 'png');
		assert.deepEqual([out.width, out.height], [540, 1080]);
	});

	test('accepts WebP', async () => {
		const input = await sharp({create: {width: 200, height: 200, channels: 3, background: '#3c3'}}).webp().toBuffer();
		assert.equal((await processPhoto(input)).width, 1080);
	});

	test('rejects GIF even though sharp can read it', async () => {
		const input = await sharp({create: {width: 10, height: 10, channels: 3, background: '#33c'}}).gif().toBuffer();
		await assert.rejects(processPhoto(input), {code: 'photo_unsupported_format'});
	});

	test('rejects SVG', async () => {
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
		await assert.rejects(processPhoto(svg), {code: 'photo_unsupported_format'});
	});

	test('rejects HTML pretending to be an image', async () => {
		await assert.rejects(processPhoto(Buffer.from('<html>hi</html>')), {code: 'photo_unsupported_format'});
	});

	test('rejects truncated JPEG', async () => {
		const input = await sharp({create: {width: 800, height: 800, channels: 3, background: '#c33'}}).jpeg().toBuffer();
		await assert.rejects(processPhoto(input.subarray(0, 200)), {code: 'photo_unsupported_format'});
	});
});

// A real TLS server on 127.0.0.1 standing in for a hostile photo host. The test policy
// treats 127.0.0.1 and ::1 as "public" and everything else as blocked, so redirects to
// 127.0.0.2 play the role of a redirect into the private network.
describe('fetchPhoto against a local https server', () => {
	let server: https.Server;
	let base: string;
	let fetchLocal: ReturnType<typeof createPhotoFetcher>;
	let jpeg: Buffer;

	before(async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vosha-tls-'));
		const key = path.join(dir, 'key.pem');
		const cert = path.join(dir, 'cert.pem');
		execFileSync('openssl', [
			'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
			'-keyout', key, '-out', cert, '-subj', '/CN=localhost',
			'-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:127.0.0.2',
		], {stdio: 'ignore'});
		jpeg = await sharp({create: {width: 1600, height: 1200, channels: 3, background: '#c33'}}).jpeg().toBuffer();

		server = https.createServer({key: fs.readFileSync(key), cert: fs.readFileSync(cert)}, (req, res) => {
			const u = new URL(req.url ?? '/', 'https://x');
			const n = Number(u.searchParams.get('n') ?? 0);
			switch (u.pathname) {
				case '/ok.jpg':
					res.writeHead(200, {'content-type': 'image/jpeg'}).end(jpeg);
					break;
				case '/redirect':
					res.writeHead(302, {location: n > 0 ? `/redirect?n=${n - 1}` : '/ok.jpg'}).end();
					break;
				case '/to-private':
					res.writeHead(302, {location: u.searchParams.get('to') ?? ''}).end();
					break;
				case '/big-declared':
					res.writeHead(200, {'content-length': String(MAX_PHOTO_BYTES + 1)}).end();
					break;
				case '/big-chunked': {
					// No content-length: the cap has to be enforced on the stream.
					res.writeHead(200, {'content-type': 'image/jpeg'});
					const chunk = Buffer.alloc(1024 * 1024);
					let sent = 0;
					const pump = () => {
						while (sent < 20 && !res.destroyed) {
							sent++;
							if (!res.write(chunk)) return res.once('drain', pump);
						}
						res.end();
					};
					pump();
					break;
				}
				case '/slow':
					res.writeHead(200, {'content-type': 'image/jpeg'});
					res.write(jpeg.subarray(0, 100)); // then stall forever
					break;
				case '/fake.jpg':
					res.writeHead(200, {'content-type': 'image/jpeg'}).end('<html>not an image</html>');
					break;
				default:
					res.writeHead(404).end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const {port} = server.address() as AddressInfo;
		base = `https://127.0.0.1:${port}`;
		fetchLocal = createPhotoFetcher({
			isAllowedAddress: (ip) => ip === '127.0.0.1' || ip === '::1',
			requireDefaultPort: false,
			ca: fs.readFileSync(cert),
		});
	});

	after(() => {
		server.closeAllConnections();
		server.close();
	});

	test('fetches and resizes', async () => {
		const out = await fetchLocal(`${base}/ok.jpg`);
		assert.deepEqual([out.width, out.height], [1080, 810]);
	});

	test('follows up to 3 redirects', async () => {
		const out = await fetchLocal(`${base}/redirect?n=2`); // 3 hops total
		assert.equal(out.width, 1080);
	});

	test('refuses a 4th redirect', async () => {
		await assert.rejects(fetchLocal(`${base}/redirect?n=3`), {code: 'photo_too_many_redirects'});
	});

	test('re-checks the host after a redirect', async () => {
		const port = new URL(base).port;
		await assert.rejects(fetchLocal(`${base}/to-private?to=https://127.0.0.2:${port}/ok.jpg`), {code: 'photo_blocked_host'});
	});

	test('refuses a redirect down to http', async () => {
		await assert.rejects(fetchLocal(`${base}/to-private?to=http://127.0.0.1/ok.jpg`), {code: 'photo_invalid_url'});
	});

	test('refuses a redirect to the metadata endpoint', async () => {
		await assert.rejects(
			fetchLocal(`${base}/to-private?to=https://169.254.169.254/latest/meta-data/`),
			{code: 'photo_blocked_host'},
		);
	});

	test('rejects an oversized content-length up front', async () => {
		await assert.rejects(fetchLocal(`${base}/big-declared`), {code: 'photo_too_large'});
	});

	test('enforces the 8MB cap while streaming', async () => {
		await assert.rejects(fetchLocal(`${base}/big-chunked`), {code: 'photo_too_large'});
	});

	test('times out a stalled download after ~5s', async () => {
		const start = Date.now();
		await assert.rejects(fetchLocal(`${base}/slow`), {code: 'photo_timeout'});
		const elapsed = Date.now() - start;
		assert.ok(elapsed >= 4900 && elapsed < 7000, `took ${elapsed}ms`);
	});

	test('rejects non-image bytes served as image/jpeg', async () => {
		await assert.rejects(fetchLocal(`${base}/fake.jpg`), {code: 'photo_unsupported_format'});
	});

	test('rejects a 404', async () => {
		await assert.rejects(fetchLocal(`${base}/missing`), {code: 'photo_fetch_failed'});
	});
});
