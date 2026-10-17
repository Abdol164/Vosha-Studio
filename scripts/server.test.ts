import assert from 'node:assert/strict';
import fs from 'node:fs';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {Server} from 'node:http';
import {after, before, beforeEach, describe, test} from 'node:test';
import type {DropCopy} from '../remotion/types.js';
import {type AppDeps, createApp} from '../src/app.js';
import {PhotoError} from '../src/image.js';
import {RenderQueue} from '../src/queue.js';
import {ensureDataDirs, getDrop, mediaDir} from '../src/store.js';

const COPY: DropCopy = {
	hook: 'NEW DROP',
	lines: ['100% original'],
	cta: 'DM to order',
	caption: 'AF1 <script>alert(1)</script> don land',
	hashtags: ['#AF1'],
};

const VALID = {
	product_name: "Nike Air Force 1 '07",
	price: '₦45,000',
	photo_url: 'https://example.com/shoe.jpg',
	points: ['100% original', 'Sizes 40 to 45'],
	language: 'pcg',
	handle: '@shoebaby',
};

// Per-test behaviour, swapped by individual tests.
let fetchPhotoImpl: AppDeps['fetchPhoto'];
let renderImpl: AppDeps['render'];
let queue: RenderQueue;
let server: Server;
let baseUrl: string;

before(async () => {
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vosha-server-'));
	await ensureDataDirs();
	queue = new RenderQueue(1, 5);
	const app = createApp({
		fetchPhoto: (url) => fetchPhotoImpl(url),
		writeCopy: async () => COPY,
		render: (id, props) => renderImpl(id, props),
		get queue() {
			return queue;
		},
		publicBaseUrl: 'https://drop.test/',
		internalBaseUrl: 'http://127.0.0.1:9',
	});
	server = app.listen(0);
	await new Promise((resolve) => server.once('listening', resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

beforeEach(() => {
	queue = new RenderQueue(1, 5);
	fetchPhotoImpl = async () => ({data: Buffer.from('jpegbytes'), format: 'jpeg', width: 1080, height: 1080});
	renderImpl = async (id) => {
		fs.writeFileSync(path.join(mediaDir(), `${id}.mp4`), 'mp4');
		fs.writeFileSync(path.join(mediaDir(), `${id}.jpg`), 'jpg');
		return {video: `${id}.mp4`, poster: `${id}.jpg`};
	};
});

function postDrop(body: unknown, raw = false) {
	return fetch(`${baseUrl}/drop`, {
		method: 'POST',
		headers: {'content-type': 'application/json'},
		body: raw ? (body as string) : JSON.stringify(body),
	});
}

describe('GET routes', () => {
	test('/health reports queue stats', async () => {
		const res = await fetch(`${baseUrl}/health`);
		assert.equal(res.status, 200);
		const body = await res.json();
		assert.equal(body.ok, true);
		assert.equal(body.queue.concurrency, 1);
	});

	test('/templates lists brutal', async () => {
		const body = await (await fetch(`${baseUrl}/templates`)).json();
		assert.ok(body.templates.some((t: {id: string}) => t.id === 'brutal'));
	});

	test('/ is html', async () => {
		const res = await fetch(`${baseUrl}/`);
		assert.equal(res.status, 200);
		assert.match(res.headers.get('content-type') ?? '', /text\/html/);
	});

	for (const id of ['nope', 'drp_../../x', 'drp_aaaaaaaa']) {
		test(`/d/${id} is 404`, async () => {
			const res = await fetch(`${baseUrl}/d/${encodeURIComponent(id)}`);
			assert.equal(res.status, 404);
		});
	}

	test('/media does not escape the media dir', async () => {
		fs.writeFileSync(path.join(process.env.DATA_DIR!, 'secret.txt'), 'secret');
		for (const p of ['/media/../secret.txt', '/media/%2e%2e%2fsecret.txt', '/media/..%2fsecret.txt']) {
			const res = await fetch(`${baseUrl}${p}`);
			assert.notEqual(res.status, 200, p);
			assert.doesNotMatch(await res.text(), /secret/);
		}
	});

	test('unknown route is a JSON 404', async () => {
		const res = await fetch(`${baseUrl}/nope`);
		assert.equal(res.status, 404);
		assert.equal((await res.json()).error, 'not_found');
	});
});

describe('POST /drop validation', () => {
	const cases: Array<[string, unknown]> = [
		['extra key', {...VALID, extra: 1}],
		['http photo_url', {...VALID, photo_url: 'http://example.com/a.jpg'}],
		['no points', {...VALID, points: []}],
		['4 points', {...VALID, points: ['a', 'b', 'c', 'd']}],
		['81-char point', {...VALID, points: ['x'.repeat(81)]}],
		['61-char name', {...VALID, product_name: 'x'.repeat(61)}],
		['bad language', {...VALID, language: 'fr'}],
		['missing price', {...VALID, price: undefined}],
	];
	for (const [name, body] of cases) {
		test(`${name} → 400`, async () => {
			const res = await postDrop(body);
			assert.equal(res.status, 400);
			assert.equal((await res.json()).error, 'invalid_request');
		});
	}

	test('malformed JSON → JSON 400', async () => {
		const res = await postDrop('{nope', true);
		assert.equal(res.status, 400);
		assert.equal((await res.json()).error, 'invalid_request');
	});

	test('oversized body → 413', async () => {
		const res = await postDrop({...VALID, handle: 'x'.repeat(20_000)});
		assert.equal(res.status, 413);
	});
});

describe('POST /drop flow', () => {
	test('success returns URLs, saves a done record, and the page renders escaped', async () => {
		let renderedPhotoUrl = '';
		const inner = renderImpl;
		renderImpl = async (id, props) => {
			renderedPhotoUrl = props.photoUrl;
			return inner(id, props);
		};
		const res = await postDrop(VALID);
		assert.equal(res.status, 200);
		const body = await res.json();
		assert.match(body.id, /^drp_/);
		assert.equal(body.video_url, `https://drop.test/media/${body.id}.mp4`);
		assert.equal(body.poster_url, `https://drop.test/media/${body.id}.jpg`);
		assert.equal(body.page_url, `https://drop.test/d/${body.id}`);
		assert.equal(body.caption, COPY.caption);
		assert.equal(renderedPhotoUrl, `http://127.0.0.1:9/media/${body.id}-photo.jpg`);

		const drop = await getDrop(body.id);
		assert.equal(drop?.status, 'done');
		assert.equal(drop?.video, `${body.id}.mp4`);

		const page = await fetch(`${baseUrl}/d/${body.id}`);
		assert.equal(page.status, 200);
		const html = await page.text();
		assert.ok(html.includes(`https://drop.test/media/${body.id}.mp4`));
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

		const media = await fetch(`${baseUrl}/media/${body.id}.mp4`);
		assert.equal(await media.text(), 'mp4');
	});

	test('photo errors map to 4xx with their code', async () => {
		for (const [code, status] of [
			['photo_invalid_url', 400],
			['photo_blocked_host', 422],
			['photo_too_large', 422],
			['photo_timeout', 422],
		] as const) {
			fetchPhotoImpl = async () => {
				throw new PhotoError(code, 'nope');
			};
			const res = await postDrop(VALID);
			assert.equal(res.status, status, code);
			assert.equal((await res.json()).error, code);
		}
	});

	test('render failure → 500 and a failed record, no media served', async () => {
		let failedId = '';
		renderImpl = async (id) => {
			failedId = id;
			throw new Error('chrome died');
		};
		const res = await postDrop(VALID);
		assert.equal(res.status, 500);
		assert.equal((await res.json()).error, 'render_failed');
		const drop = await getDrop(failedId);
		assert.equal(drop?.status, 'failed');
		const page = await (await fetch(`${baseUrl}/d/${failedId}`)).text();
		assert.match(page, /failed to render/);
	});

	test('full queue → 503 before any photo fetch', async () => {
		let fetched = false;
		fetchPhotoImpl = async () => {
			fetched = true;
			throw new Error('should not run');
		};
		queue = {isFull: () => true, stats: {}} as unknown as RenderQueue;
		const res = await postDrop(VALID);
		assert.equal(res.status, 503);
		assert.equal(res.headers.get('retry-after'), '60');
		assert.equal(fetched, false);
	});
});
