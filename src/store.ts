import fs from 'node:fs/promises';
import path from 'node:path';
import {customAlphabet} from 'nanoid';
import type {DropCopy, StatusDropProps} from '../remotion/types.js';
import type {PhotoErrorCode} from './image.js';

export const DROP_ID_PATTERN = /^drp_[A-Za-z0-9_-]{8}$/;

// Spelled out rather than relying on nanoid's default alphabet, so ids are guaranteed
// to match DROP_ID_PATTERN whatever nanoid changes.
const nanoid8 = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', 8);

export function newDropId(): string {
	return `drp_${nanoid8()}`;
}

export function isDropId(id: string): boolean {
	return DROP_ID_PATTERN.test(id);
}

export type DropStatus = 'rendering' | 'done' | 'failed';

// Exposed externally via GET /d/:id's JSON response, so it's a closed set rather than
// free-text (err.message/String(err)) -- raw exception detail stays in the logs only.
export type DropErrorCode = PhotoErrorCode | 'queue_full' | 'render_failed' | 'internal_error';

export interface DropRecord {
	id: string;
	status: DropStatus;
	createdAt: string;
	updatedAt: string;
	props: StatusDropProps;
	copy: DropCopy;
	// File names inside the media dir, set once the render finishes.
	video?: string;
	poster?: string;
	error?: DropErrorCode;
}

export function dataDir(): string {
	return path.resolve(process.env.DATA_DIR ?? './data');
}

export function dropsDir(): string {
	return path.join(dataDir(), 'drops');
}

export function mediaDir(): string {
	return path.join(dataDir(), 'media');
}

export async function ensureDataDirs(): Promise<void> {
	await fs.mkdir(dropsDir(), {recursive: true});
	await fs.mkdir(mediaDir(), {recursive: true});
}

// The id is the only thing that becomes part of a path, so it is validated on every
// access — /d/:id and friends pass caller input straight through to here.
function dropPath(id: string): string {
	if (!isDropId(id)) {
		throw new Error(`invalid drop id: ${id}`);
	}
	return path.join(dropsDir(), `${id}.json`);
}

// Write-then-rename so a reader never sees a half-written record, even if the process
// dies mid-write.
export async function saveDrop(record: DropRecord): Promise<void> {
	const file = dropPath(record.id);
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(record, null, 2));
	await fs.rename(tmp, file);
}

export async function getDrop(id: string): Promise<DropRecord | null> {
	if (!isDropId(id)) return null;
	try {
		return JSON.parse(await fs.readFile(dropPath(id), 'utf8')) as DropRecord;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

export async function updateDrop(id: string, patch: Partial<Omit<DropRecord, 'id' | 'createdAt'>>): Promise<DropRecord> {
	const current = await getDrop(id);
	if (!current) {
		throw new Error(`drop not found: ${id}`);
	}
	const next: DropRecord = {...current, ...patch, id, updatedAt: new Date().toISOString()};
	await saveDrop(next);
	return next;
}
