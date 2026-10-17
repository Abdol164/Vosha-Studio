import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {before, describe, test} from 'node:test';
import {QueueFullError, RenderQueue, concurrencyFromEnv} from '../src/queue.js';
import {type DropRecord, ensureDataDirs, getDrop, isDropId, newDropId, saveDrop, updateDrop} from '../src/store.js';

describe('drop ids', () => {
	test('newDropId matches the spec pattern', () => {
		for (let i = 0; i < 1000; i++) {
			const id = newDropId();
			assert.ok(isDropId(id), id);
		}
	});

	for (const bad of ['drp_1234567', 'drp_123456789', 'drp_../../etc', 'drp_abc/defg', 'DRP_abcdefgh', 'x', '']) {
		test(`rejects ${JSON.stringify(bad)}`, () => assert.equal(isDropId(bad), false));
	}
});

describe('store', () => {
	before(async () => {
		process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vosha-store-'));
		await ensureDataDirs();
	});

	const record = (id: string): DropRecord => ({
		id,
		status: 'rendering',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		props: {
			productName: 'AF1',
			price: '₦45,000',
			photoUrl: 'x.jpg',
			points: ['original'],
			copy: {hook: 'NEW DROP', lines: ['original'], cta: 'DM', caption: 'c', hashtags: ['#a']},
			template: 'brutal',
		},
		copy: {hook: 'NEW DROP', lines: ['original'], cta: 'DM', caption: 'c', hashtags: ['#a']},
	});

	test('round-trips a record as data/drops/{id}.json', async () => {
		const id = newDropId();
		await saveDrop(record(id));
		assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, 'drops', `${id}.json`)));
		assert.equal((await getDrop(id))?.id, id);
	});

	test('updateDrop merges and bumps updatedAt, keeps id', async () => {
		const id = newDropId();
		await saveDrop({...record(id), updatedAt: '2000-01-01T00:00:00.000Z'});
		const next = await updateDrop(id, {status: 'done', video: `${id}.mp4`});
		assert.equal(next.status, 'done');
		assert.equal(next.video, `${id}.mp4`);
		assert.notEqual(next.updatedAt, '2000-01-01T00:00:00.000Z');
		assert.deepEqual(await getDrop(id), next);
	});

	test('missing and malformed ids read as null', async () => {
		assert.equal(await getDrop('drp_AAAAAAAA'), null);
		assert.equal(await getDrop('../../../etc/passwd'), null);
	});

	test('saveDrop refuses a bad id', async () => {
		await assert.rejects(saveDrop(record('drp_../evil')));
	});
});

describe('RenderQueue', () => {
	const deferred = () => {
		let resolve!: () => void;
		const promise = new Promise<void>((r) => (resolve = r));
		return {promise, resolve};
	};

	test('MAX_CONCURRENT_RENDERS parsing clamps to 1..2', () => {
		assert.equal(concurrencyFromEnv(undefined), 1);
		assert.equal(concurrencyFromEnv('abc'), 1);
		assert.equal(concurrencyFromEnv('0'), 1);
		assert.equal(concurrencyFromEnv('2'), 2);
		assert.equal(concurrencyFromEnv('8'), 2);
	});

	test('never runs more than `concurrency` jobs and runs them in order', async () => {
		const q = new RenderQueue(2, 10);
		let active = 0;
		let peak = 0;
		const order: number[] = [];
		const jobs = Array.from({length: 6}, (_, i) =>
			q.run(async () => {
				active++;
				peak = Math.max(peak, active);
				order.push(i);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return i;
			}),
		);
		assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5]);
		assert.equal(peak, 2);
		assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
		assert.deepEqual(q.stats, {running: 0, waiting: 0, concurrency: 2});
	});

	test('refuses work once 5 jobs are waiting; isFull() agrees', async () => {
		const q = new RenderQueue(1, 5);
		const gate = deferred();
		const jobs = [q.run(() => gate.promise)];
		for (let i = 0; i < 5; i++) {
			assert.equal(q.isFull(), false);
			jobs.push(q.run(async () => {}));
		}
		assert.equal(q.isFull(), true);
		await assert.rejects(q.run(async () => {}), QueueFullError);
		gate.resolve();
		await Promise.all(jobs);
		assert.equal(q.isFull(), false);
	});

	test('a failing job frees its slot and reports its error', async () => {
		const q = new RenderQueue(1, 5);
		await assert.rejects(q.run(async () => { throw new Error('render blew up'); }), /render blew up/);
		assert.equal(await q.run(async () => 'ok'), 'ok');
		assert.equal(q.stats.running, 0);
	});
});
