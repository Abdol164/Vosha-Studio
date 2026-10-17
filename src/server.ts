// First: loads .env before any module reads process.env (queue.ts does at import).
import './env.js';
import {createApp} from './app.js';
import {backgroundRemovalEnabled, removeProductBackground} from './background-removal.js';
import {writeCopy} from './copywriter.js';
import {fetchPhoto} from './image.js';
import {pickRandomTrack} from './music.js';
import {renderQueue} from './queue.js';
import {createRenderer} from './render.js';
import {ensureDataDirs} from './store.js';
import {logger} from './log.js';
import {generateVoiceover} from './voiceover.js';
import {NETWORKS, createPaidMiddleware, x402ConfigFromEnv} from './x402.js';

// Log a crash before Node's default handler exits, so it shows in Brimble's logs as JSON.
process.on('unhandledRejection', (reason) => {
	logger.error('process.unhandled_rejection', {error: reason, stack: (reason as Error)?.stack});
});
process.on('uncaughtException', (err) => {
	logger.error('process.uncaught_exception', {error: err, stack: err.stack});
	process.exit(1);
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const internalBaseUrl = `http://127.0.0.1:${port}`;
const publicBaseUrl = process.env.PUBLIC_BASE_URL || internalBaseUrl;
// Before the slow steps, so a bad payment config fails in a second, not after a bundle.
const x402 = x402ConfigFromEnv(process.env, publicBaseUrl);

await ensureDataDirs();
logger.info('startup.renderer', {note: 'ensuring Chrome Headless Shell + Remotion bundle', prebuilt: process.env.REMOTION_BUNDLE_DIR ?? null});
// Bundle before listening so the first paid request never waits on (or fails in) the bundle.
const render = await createRenderer();

const backgroundRemoval = backgroundRemovalEnabled();


const app = createApp({
	fetchPhoto,
	writeCopy,
	generateVoiceover,
	removeBackground: backgroundRemoval ? removeProductBackground : undefined,
	pickTrack: pickRandomTrack,
	render,
	queue: renderQueue,
	publicBaseUrl,
	internalBaseUrl,
	paid: [createPaidMiddleware(x402)],
});
app.listen(port, () => {
	logger.info('startup.listening', {
		port,
		publicBaseUrl,
		logLevel: process.env.LOG_LEVEL ?? 'info',
		backgroundRemoval,
		x402: {network: NETWORKS[x402.network].network, amount: x402.amount, payTo: x402.payTo, facilitator: x402.facilitatorUrl},
		voiceover: Boolean(process.env.ELEVENLABS_API_KEY),
		copywriterLlm: Boolean(process.env.ANTHROPIC_API_KEY),
		maxConcurrentRenders: renderQueue.concurrency,
	});
});
