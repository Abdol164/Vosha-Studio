import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import type {IncomingMessage} from 'node:http';
import type {LookupFunction} from 'node:net';
import sharp from 'sharp';

// Security-critical (MON-37): photo_url is caller-controlled, so every fetch has to be
// treated as a potential SSRF probe. Rules:
//   - https only, default port only, no credentials in the URL
//   - every address a hostname resolves to must be public unicast; checked inside the
//     socket's own DNS lookup, so the address we vet is the address we connect to (no
//     DNS-rebinding gap between "check" and "connect")
//   - redirects are followed manually (max 3) and every hop is re-checked from scratch
//   - 5s deadline for the whole fetch, 8MB cap enforced while streaming
//   - content type is decided by sharp sniffing the magic bytes, never by headers

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_TIMEOUT_MS = 5_000;
export const MAX_REDIRECTS = 3;
export const PHOTO_LONG_EDGE = 1080;
const MAX_URL_LENGTH = 2048;
// Decompression-bomb guard: an 8MB PNG can still claim enormous dimensions.
const MAX_INPUT_PIXELS = 50_000_000;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type PhotoErrorCode =
	| 'photo_invalid_url'
	| 'photo_blocked_host'
	| 'photo_fetch_failed'
	| 'photo_too_many_redirects'
	| 'photo_timeout'
	| 'photo_too_large'
	| 'photo_unsupported_format';

export class PhotoError extends Error {
	constructor(
		readonly code: PhotoErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'PhotoError';
	}
}

export interface ProcessedPhoto {
	data: Buffer;
	format: 'jpeg' | 'png';
	width: number;
	height: number;
}

// Everything that is not globally routable unicast. 169.254.0.0/16 covers the
// 169.254.169.254 cloud metadata endpoint.
const BLOCKED_V4 = new net.BlockList();
for (const [prefix, bits] of [
	['0.0.0.0', 8], // "this network"
	['10.0.0.0', 8], // private
	['100.64.0.0', 10], // carrier-grade NAT
	['127.0.0.0', 8], // loopback
	['169.254.0.0', 16], // link-local + metadata
	['172.16.0.0', 12], // private
	['192.0.0.0', 24], // IETF protocol assignments
	['192.0.2.0', 24], // TEST-NET-1
	['192.88.99.0', 24], // 6to4 relay anycast
	['192.168.0.0', 16], // private
	['198.18.0.0', 15], // benchmarking
	['198.51.100.0', 24], // TEST-NET-2
	['203.0.113.0', 24], // TEST-NET-3
	['224.0.0.0', 4], // multicast
	['240.0.0.0', 4], // reserved + broadcast
] as const) {
	BLOCKED_V4.addSubnet(prefix, bits, 'ipv4');
}

// For IPv6 we allow only global unicast (2000::/3) and then carve out the ranges inside
// it that are special-purpose or tunnel to an embedded IPv4 address we can't vouch for.
const GLOBAL_UNICAST_V6 = new net.BlockList();
GLOBAL_UNICAST_V6.addSubnet('2000::', 3, 'ipv6');
const BLOCKED_V6 = new net.BlockList();
for (const [prefix, bits] of [
	['2001::', 32], // Teredo
	['2001:db8::', 32], // documentation
	['2002::', 16], // 6to4
] as const) {
	BLOCKED_V6.addSubnet(prefix, bits, 'ipv6');
}

// IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses reach the embedded
// IPv4 host, so judge them by that address.
function embeddedIpv4(ip: string): string | null {
	const lower = ip.toLowerCase();
	for (const prefix of ['::ffff:', '64:ff9b::']) {
		if (!lower.startsWith(prefix)) continue;
		const rest = lower.slice(prefix.length);
		if (net.isIPv4(rest)) return rest;
		const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
		if (hex) {
			const hi = parseInt(hex[1]!, 16);
			const lo = parseInt(hex[2]!, 16);
			return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
		}
	}
	return null;
}

export function isPublicAddress(ip: string): boolean {
	if (net.isIPv4(ip)) {
		return !BLOCKED_V4.check(ip, 'ipv4');
	}
	if (net.isIPv6(ip)) {
		const v4 = embeddedIpv4(ip);
		if (v4) return isPublicAddress(v4);
		return GLOBAL_UNICAST_V6.check(ip, 'ipv6') && !BLOCKED_V6.check(ip, 'ipv6');
	}
	return false;
}

export interface PhotoFetchPolicy {
	isAllowedAddress: (ip: string) => boolean;
	// Only the default https port (443). Tests turn this off to reach a local server.
	requireDefaultPort: boolean;
	// Extra trusted CA, for tests against a self-signed local server.
	ca?: string | Buffer;
}

const STRICT_POLICY: PhotoFetchPolicy = {
	isAllowedAddress: isPublicAddress,
	requireDefaultPort: true,
};

function blocked(host: string): PhotoError {
	return new PhotoError('photo_blocked_host', `photo_url host ${host} resolves to a non-public address`);
}

function parsePhotoUrl(raw: string, policy: PhotoFetchPolicy): URL {
	if (raw.length > MAX_URL_LENGTH) {
		throw new PhotoError('photo_invalid_url', 'photo_url is too long');
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new PhotoError('photo_invalid_url', 'photo_url is not a valid URL');
	}
	if (url.protocol !== 'https:') {
		throw new PhotoError('photo_invalid_url', 'photo_url must use https');
	}
	if (url.username || url.password) {
		throw new PhotoError('photo_invalid_url', 'photo_url must not contain credentials');
	}
	if (policy.requireDefaultPort && url.port !== '') {
		throw new PhotoError('photo_invalid_url', 'photo_url must use the default https port');
	}
	// Node skips the lookup hook entirely for IP literals, so they are checked here.
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (net.isIP(host) && !policy.isAllowedAddress(host)) {
		throw blocked(host);
	}
	return url;
}

// Resolves every address for the host and refuses the connection if any of them is
// blocked — not just the one we'd pick — so a mixed public/private record set fails.
function guardedLookup(policy: PhotoFetchPolicy): LookupFunction {
	return (hostname, options, callback) => {
		dns.lookup(hostname, {family: options.family, hints: options.hints, all: true}, (err, addresses) => {
			if (err) return callback(err, '', 0);
			if (addresses.length === 0 || addresses.some((a) => !policy.isAllowedAddress(a.address))) {
				return callback(blocked(hostname), '', 0);
			}
			if (options.all) {
				return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
			}
			const first = addresses[0]!;
			callback(null, first.address, first.family);
		});
	};
}

function requestOnce(url: URL, policy: PhotoFetchPolicy, signal: AbortSignal): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const req = https.request(url, {
			method: 'GET',
			agent: false,
			lookup: guardedLookup(policy),
			signal,
			ca: policy.ca,
			headers: {
				accept: 'image/jpeg, image/png, image/webp',
				'accept-encoding': 'identity',
				'user-agent': 'VoshaStudio/0.1 (+photo fetch)',
			},
		});
		req.on('response', (res) => {
			// The deadline abort can land after we've moved on from this response (e.g. a
			// drained redirect); without a listener that late error would crash the process.
			res.on('error', () => {});
			resolve(res);
		});
		req.on('error', reject);
		req.end();
	});
}

function readCapped(res: IncomingMessage): Promise<Buffer> {
	const declared = Number(res.headers['content-length']);
	if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) {
		res.destroy();
		return Promise.reject(new PhotoError('photo_too_large', 'photo is larger than 8MB'));
	}
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		res.on('data', (chunk: Buffer) => {
			total += chunk.length;
			if (total > MAX_PHOTO_BYTES) {
				// Reject before destroying: destroy() fires 'aborted' synchronously, and that
				// handler would otherwise win and mislabel this as a cut-off download.
				reject(new PhotoError('photo_too_large', 'photo is larger than 8MB'));
				res.destroy();
				return;
			}
			chunks.push(chunk);
		});
		res.on('end', () => resolve(Buffer.concat(chunks)));
		res.on('error', reject);
		res.on('aborted', () => reject(new PhotoError('photo_fetch_failed', 'photo download was cut off')));
	});
}

async function download(rawUrl: string, policy: PhotoFetchPolicy): Promise<Buffer> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
	try {
		let url = parsePhotoUrl(rawUrl, policy);
		for (let hop = 0; ; hop++) {
			const res = await requestOnce(url, policy, controller.signal);
			if (REDIRECT_STATUSES.has(res.statusCode ?? 0)) {
				res.resume();
				const location = res.headers.location;
				if (!location) {
					throw new PhotoError('photo_fetch_failed', 'photo redirect has no location');
				}
				if (hop >= MAX_REDIRECTS) {
					throw new PhotoError('photo_too_many_redirects', `photo_url redirected more than ${MAX_REDIRECTS} times`);
				}
				url = parsePhotoUrl(new URL(location, url).toString(), policy);
				continue;
			}
			if (res.statusCode !== 200) {
				res.resume();
				throw new PhotoError('photo_fetch_failed', `photo_url returned HTTP ${res.statusCode}`);
			}
			return await readCapped(res);
		}
	} catch (err) {
		if (controller.signal.aborted) {
			throw new PhotoError('photo_timeout', `photo fetch took longer than ${PHOTO_TIMEOUT_MS / 1000}s`);
		}
		if (err instanceof PhotoError) throw err;
		throw new PhotoError('photo_fetch_failed', `could not fetch photo_url: ${(err as Error).message}`);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

// Validates the bytes are really a JPEG/PNG/WebP (sharp sniffs the magic bytes) and
// normalises to 1080px on the long edge, EXIF-rotated, metadata stripped. Transparent
// images stay PNG so cut-out product shots keep their background; the rest become JPEG.
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
	const options = {limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error'} as const;
	let format: string | undefined;
	let hasAlpha = false;
	try {
		const meta = await sharp(input, options).metadata();
		format = meta.format;
		hasAlpha = meta.hasAlpha ?? false;
	} catch {
		throw new PhotoError('photo_unsupported_format', 'photo is not a readable image');
	}
	if (!format || !ALLOWED_FORMATS.has(format)) {
		throw new PhotoError('photo_unsupported_format', 'photo must be a JPEG, PNG or WebP image');
	}

	try {
		const pipeline = sharp(input, options)
			.rotate()
			.resize({width: PHOTO_LONG_EDGE, height: PHOTO_LONG_EDGE, fit: 'inside'});
		const out = hasAlpha ? pipeline.png() : pipeline.jpeg({quality: 88, mozjpeg: true});
		const {data, info} = await out.toBuffer({resolveWithObject: true});
		return {data, format: hasAlpha ? 'png' : 'jpeg', width: info.width, height: info.height};
	} catch {
		throw new PhotoError('photo_unsupported_format', 'photo could not be decoded');
	}
}

export function createPhotoFetcher(policy: PhotoFetchPolicy) {
	return async (photoUrl: string): Promise<ProcessedPhoto> => processPhoto(await download(photoUrl, policy));
}

export const fetchPhoto = createPhotoFetcher(STRICT_POLICY);
